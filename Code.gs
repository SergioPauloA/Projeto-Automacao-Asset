/**
 * BANESTES · Sistema de Automação Setorial
 * Desenvolvido por Sergio Paulo de Andrade
 *
 * Backend Google Apps Script
 *  - doGet()  → serve o Web App (dashboard HTML)
 *  - doPost() → recebe dados IoT via Webhook (Tuya/Zigbee2MQTT/Make.com)
 *  - Regras de automação (intertravamento, auto-off, inatividade)
 *  - Persistência em Google Sheets (logs + consumo)
 *  - Relatórios por e-mail
 *
 * ⚠ MODO MOCK ATIVO: hardware ainda não instalado.
 *   Todos os dados são simulados via PropertiesService/mock até a integração real.
 *
 * Para implantar:
 *   1. Implantações → Nova implantação → Web App
 *   2. Execute como: Eu mesmo | Quem tem acesso: Qualquer pessoa (ou domínio Google)
 *   3. Execute setupTriggers() uma vez para ativar automações periódicas
 *   4. Execute setupSheets()  uma vez para criar as abas no Sheets
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÕES GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────

var CONFIG = {
  LOG_SHEET:          'Logs',
  CONSUMPTION_SHEET:  'Consumo',
  DEVICES_SHEET:      'Dispositivos',
  TARIFF_RS_KWH:      1.2171,   // Tarifa ANEEL — ajuste conforme fatura do banco
  INTERLOCK_W:        1000,     // Watts da cafeteira que dispara bloqueio da picotadora
  INACTIVITY_MIN:     30,       // Minutos em standby antes de desligar cafeteira
  AUTO_OFF_HOUR:      18,       // Hora de desligamento programado dos ACs (formato 24h)
  AC_POWER_KW:        3.0,      // Potência nominal por unidade de AC LG 30000 BTU (kW)
  AC_EFFICIENCY:      0.9,      // Fator de carga médio (ACs raramente operam a 100%)
  TIMEZONE:           'America/Sao_Paulo',
  HTML_FILENAME:      'banestes_asset_management_dashboard',
  APP_TITLE:          'BANESTES · Automação Setorial',
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS DO WEB APP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serve o Web App — chamado automaticamente pelo GAS ao acessar a URL publicada.
 */
function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile(CONFIG.HTML_FILENAME)
    .setTitle(CONFIG.APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Webhook receiver — recebe eventos IoT de dispositivos em tempo real.
 *
 * Payload esperado (JSON via HTTP POST):
 * {
 *   "device"    : "caf1" | "caf2" | "pico" | "ac01" … "ac16",
 *   "state"     : "on" | "off",
 *   "watts"     : 1450,
 *   "timestamp" : "2025-09-01T14:10:00Z"   // opcional
 * }
 *
 * Compatível com:
 *   - Tuya Cloud (IoT Core webhook)
 *   - Zigbee2MQTT (HTTP bridge)
 *   - Make.com / IFTTT (webhook step)
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var result  = processWebhookPayload(payload);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    logEvent('SISTEMA', 'ERRO_WEBHOOK', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API DE DADOS — chamadas pelo cliente via google.script.run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna snapshot completo do estado dos dispositivos.
 * O dashboard chama esta função ao carregar e a cada ciclo de refresh.
 */
function getDashboardData() {
  var props     = PropertiesService.getScriptProperties();
  var stateJson = props.getProperty('DEVICE_STATE');
  var state     = stateJson ? JSON.parse(stateJson) : getDefaultState();

  // Aplica regras de intertravamento antes de retornar
  var caf1W = state.plugs.caf1.on ? (state.plugs.caf1.watts || 0) : 0;
  state.plugs.pico.blocked = caf1W > CONFIG.INTERLOCK_W;

  // Calcula minutos de inatividade de cada cafeteira
  var now = Date.now();
  ['caf1', 'caf2'].forEach(function(id) {
    var plug = state.plugs[id];
    if (plug.on && plug.lastActiveMs) {
      plug.inactiveMin = Math.floor((now - plug.lastActiveMs) / 60000);
    } else {
      plug.inactiveMin = plug.on ? 0 : null;
    }
  });

  state.timestamp = new Date().toISOString();
  state.summary   = buildSummary(state);

  return state;
}

/**
 * Alterna o estado de uma tomada inteligente (Smart Plug).
 * @param {string}  deviceId     'caf1' | 'caf2' | 'pico'
 * @param {boolean} desiredState true = ligar, false = desligar, undefined = toggle
 */
function togglePlug(deviceId, desiredState) {
  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();

  if (!state.plugs[deviceId]) {
    return { error: 'Dispositivo não encontrado: ' + deviceId };
  }

  var plug    = state.plugs[deviceId];
  plug.on     = (desiredState !== undefined) ? !!desiredState : !plug.on;
  plug.lastActiveMs = plug.on ? Date.now() : plug.lastActiveMs;

  // Intertravamento: cafeteira 1 desligada → libera picotadora
  if (deviceId === 'caf1' && !plug.on) {
    state.plugs.pico.blocked = false;
  }

  props.setProperty('DEVICE_STATE', JSON.stringify(state));
  logEvent(deviceId, plug.on ? 'LIGADO' : 'DESLIGADO', plug.watts + 'W');

  return { ok: true, state: plug };
}

/**
 * Alterna o estado de um ar-condicionado pelo índice (0-based).
 * @param {number}  acIndex      0 a 15
 * @param {boolean} desiredState true = ligar, false = desligar, undefined = toggle
 */
function toggleAc(acIndex, desiredState) {
  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();

  if (acIndex < 0 || acIndex >= state.acs.length) {
    return { error: 'Índice AC inválido: ' + acIndex };
  }
  if (state.acs[acIndex].autoOff) {
    return { error: 'AC em modo auto-off. Reative manualmente no painel físico.' };
  }

  var ac = state.acs[acIndex];
  ac.on  = (desiredState !== undefined) ? !!desiredState : !ac.on;

  props.setProperty('DEVICE_STATE', JSON.stringify(state));
  logEvent('AC ' + pad2(acIndex + 1), ac.on ? 'AC_LIGADO' : 'AC_DESLIGADO', ac.zone);

  return { ok: true, state: ac };
}

/**
 * Desligamento de emergência — desliga todos os dispositivos imediatamente.
 */
function emergencyOffAll() {
  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();

  Object.keys(state.plugs).forEach(function(k) { state.plugs[k].on = false; });
  state.acs.forEach(function(a) { a.on = false; });
  state.plugs.pico.blocked = false;

  props.setProperty('DEVICE_STATE', JSON.stringify(state));
  logEvent('SISTEMA', 'EMERGENCIA_DESLIGAMENTO_GERAL', 'Acionado manualmente pelo dashboard');

  return { ok: true, message: 'Desligamento geral executado com sucesso.' };
}

/**
 * Retorna histórico de eventos para exibição no log do dashboard.
 * @param {number} limit  Máximo de registros (padrão 30)
 */
function getLogs(limit) {
  limit = limit || 30;
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.LOG_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return getMockLogs();

    var rows  = sheet.getRange(2, 1, Math.min(sheet.getLastRow() - 1, limit), 5).getValues();
    return rows.reverse().map(function(r) {
      return {
        timestamp: r[0] ? Utilities.formatDate(new Date(r[0]), CONFIG.TIMEZONE, 'HH:mm') : '--',
        device:    r[1] || '',
        event:     r[2] || '',
        value:     r[3] || '',
        tag:       r[4] || 'info',
      };
    });
  } catch (e) {
    return getMockLogs();
  }
}

/**
 * Retorna dados mensais de consumo para os gráficos comparativos.
 * Em produção: lê da aba Consumo agrupando por mês.
 */
function getMonthlyConsumption() {
  return {
    months:  ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
    before:  [21500, 20800, 22100, 21900, 23400, 24100, 23800, 22900, 21700, 22300, 21100, 22800],
    after:   [null,  null,  null,  null,  null,  null,  null,  null,  15200, 15800, 14900, null],
    cost:    [null,  null,  null,  null,  null,  null,  null,  null,  18506, 19224, 18134, null],
    savings: [null,  null,  null,  null,  null,  null,  null,  null,  2660,  2772,  2561,  null],
    yearly: {
      labels: ['2023', '2024', '2025 (parcial)'],
      before: [263800, 261700, 179700],
      after:  [null,   null,   45900],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRAS DE AUTOMAÇÃO — executadas pelo trigger de 1 minuto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orquestrador principal — chamado pelo trigger time-based a cada 1 minuto.
 */
function runAutomation() {
  ruleAutoOffAt18h();
  ruleInactivityOff();
  ruleInterlock();
  updateConsumptionSheet();
}

/**
 * Regra 1 — Desligamento automático de todos os ACs às 18h.
 * Usa PropertiesService para garantir execução única por dia.
 */
function ruleAutoOffAt18h() {
  var now  = new Date();
  var hour = now.getHours();
  if (hour < CONFIG.AUTO_OFF_HOUR) return;

  // Verifica se já foi executado hoje para evitar desligamentos repetidos
  var props     = PropertiesService.getScriptProperties();
  var lastRunKey = 'AUTO_OFF_18H_LAST_DATE';
  var today     = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  if (props.getProperty(lastRunKey) === today) return;

  var props   = PropertiesService.getScriptProperties();
  var state   = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();
  var changed = false;

  state.acs.forEach(function(ac, i) {
    if (ac.on) {
      ac.on      = false;
      ac.autoOff = true;
      changed    = true;
      logEvent('AC ' + pad2(i + 1), 'AUTO_OFF_18H', ac.zone);
    }
  });

  if (changed) {
    props.setProperty('DEVICE_STATE', JSON.stringify(state));
    props.setProperty(lastRunKey, today); // marca execução do dia
    sendAlertEmail(
      'Auto-off 18h executado',
      'Todos os ares-condicionados foram desligados automaticamente às ' + CONFIG.AUTO_OFF_HOUR + 'h.'
    );
  }
}

/**
 * Regra 2 — Desliga cafeteiras após INACTIVITY_MIN minutos em standby.
 */
function ruleInactivityOff() {
  var props   = PropertiesService.getScriptProperties();
  var state   = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();
  var now     = Date.now();
  var changed = false;

  ['caf1', 'caf2'].forEach(function(id) {
    var plug = state.plugs[id];
    if (!plug.on || !plug.lastActiveMs) return;
    var standbyW    = plug.watts < 150;  // < 150W = standby (manutenção de temperatura)
    var inactiveMin = (now - plug.lastActiveMs) / 60000;
    if (standbyW && inactiveMin >= CONFIG.INACTIVITY_MIN) {
      plug.on   = false;
      changed   = true;
      logEvent(id, 'AUTO_OFF_INATIVIDADE', Math.floor(inactiveMin) + 'min em standby');
    }
  });

  if (changed) props.setProperty('DEVICE_STATE', JSON.stringify(state));
}

/**
 * Regra 3 — Intertravamento: se Cafeteira 1 > 1000W → bloqueia Picotadora.
 */
function ruleInterlock() {
  var props       = PropertiesService.getScriptProperties();
  var state       = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();
  var caf1W       = state.plugs.caf1.on ? (state.plugs.caf1.watts || 0) : 0;
  var shouldBlock = caf1W > CONFIG.INTERLOCK_W;

  if (shouldBlock === state.plugs.pico.blocked) return; // sem mudança

  state.plugs.pico.blocked = shouldBlock;
  props.setProperty('DEVICE_STATE', JSON.stringify(state));

  if (shouldBlock) {
    logEvent('pico', 'BLOQUEIO_INTERLOCK', 'Caf1=' + caf1W + 'W > ' + CONFIG.INTERLOCK_W + 'W');
  } else {
    logEvent('pico', 'DESBLOQUEIO_INTERLOCK', 'Caf1=' + caf1W + 'W');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERAÇÕES COM PLANILHAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra evento na aba Logs.
 * Cria a aba com cabeçalho caso não exista.
 */
function logEvent(device, event, value) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.LOG_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.LOG_SHEET);
      sheet.appendRow(['Timestamp', 'Dispositivo', 'Evento', 'Valor', 'Tag']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#003366').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    var tag = event.indexOf('BLOQUEIO')   >= 0 ? 'block' :
              event.indexOf('OFF')        >= 0 ? 'save'  :
              event.indexOf('ALERTA')     >= 0 ? 'warn'  :
              event.indexOf('ERRO')       >= 0 ? 'warn'  : 'info';
    sheet.appendRow([new Date(), device, event, value || '', tag]);
  } catch (e) {
    console.error('logEvent error: ' + e.message);
  }
}

/**
 * Registra snapshot de consumo na aba Consumo (chamado a cada minuto pelo trigger).
 */
function updateConsumptionSheet() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.CONSUMPTION_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.CONSUMPTION_SHEET);
      sheet.appendRow(['Timestamp', 'Total kW', 'ACs kW', 'Copa W', 'Custo incremento R$']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#003366').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    var state    = getDashboardData();
    var totalKw  = state.summary.totalKw;
    var acKw     = state.acs.filter(function(a) { return a.on; }).length * CONFIG.AC_POWER_KW * CONFIG.AC_EFFICIENCY;
    var copaW    = (state.plugs.caf1.on ? (state.plugs.caf1.watts || 0) : 0) +
                   (state.plugs.caf2.on ? (state.plugs.caf2.watts || 0) : 0);
    var costIncr = totalKw * (1 / 60) * CONFIG.TARIFF_RS_KWH; // kW × (1/60)h × R$/kWh

    sheet.appendRow([new Date(), +totalKw.toFixed(2), +acKw.toFixed(2), copaW, +costIncr.toFixed(4)]);
  } catch (e) {
    console.error('updateConsumptionSheet error: ' + e.message);
  }
}

/**
 * Inicializa todas as abas e formatos necessários na planilha.
 * Execute manualmente uma vez após criar o projeto.
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Aba Dispositivos
  var devSheet = ss.getSheetByName(CONFIG.DEVICES_SHEET);
  if (!devSheet) {
    devSheet = ss.insertSheet(CONFIG.DEVICES_SHEET);
    devSheet.appendRow(['ID', 'Nome', 'Tipo', 'Zona', 'Protocolo', 'Ativo']);
    devSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#003366').setFontColor('#ffffff');
    devSheet.setFrozenRows(1);
    var devices = [
      ['caf1', 'Cafeteira 1',       'Smart Plug 20A',    'Copa',     'Zigbee 3.0', true],
      ['caf2', 'Cafeteira 2',       'Smart Plug 20A',    'Copa',     'Zigbee 3.0', true],
      ['pico', 'Picotadora',        'Smart Plug 20A',    'Copa',     'Zigbee 3.0', true],
      ['ac01', 'AC LG 01',          'Hub IR Zigbee',     'Reunião',  'Zigbee 3.0', true],
      ['ac02', 'AC LG 02',          'Hub IR Zigbee',     'Reunião',  'Zigbee 3.0', true],
      ['ac03', 'AC LG 03',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac04', 'AC LG 04',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac05', 'AC LG 05',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac06', 'AC LG 06',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac07', 'AC LG 07',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac08', 'AC LG 08',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac09', 'AC LG 09',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac10', 'AC LG 10',          'Hub IR Zigbee',     'Salão A',  'Zigbee 3.0', true],
      ['ac11', 'AC LG 11',          'Hub IR Zigbee',     'Salão B',  'Zigbee 3.0', true],
      ['ac12', 'AC LG 12',          'Hub IR Zigbee',     'Salão B',  'Zigbee 3.0', true],
      ['ac13', 'AC LG 13',          'Hub IR Zigbee',     'Salão B',  'Zigbee 3.0', true],
      ['ac14', 'AC LG 14',          'Hub IR Zigbee',     'Salão B',  'Zigbee 3.0', true],
      ['ac15', 'AC LG 15',          'Hub IR Zigbee',     'Copa',     'Zigbee 3.0', true],
      ['ac16', 'AC LG 16',          'Hub IR Zigbee',     'Copa',     'Zigbee 3.0', true],
      ['pres1','Sensor Presença 1',  'Sensor mmWave',     'Reunião',  'Zigbee 3.0', true],
      ['pres2','Sensor Presença 2',  'Sensor PIR/mmWave', 'Salão A',  'Zigbee 3.0', true],
      ['pres3','Sensor Presença 3',  'Sensor PIR/mmWave', 'Salão B',  'Zigbee 3.0', true],
      ['pres4','Sensor Presença 4',  'Sensor PIR/mmWave', 'Copa',     'Zigbee 3.0', true],
    ];
    devices.forEach(function(d) { devSheet.appendRow(d); });
    devSheet.autoResizeColumns(1, 6);
  }

  // Cria abas de Log e Consumo com cabeçalhos
  logEvent('SISTEMA', 'SETUP_CONCLUIDO', 'Planilhas inicializadas');
  updateConsumptionSheet();

  Logger.log('setupSheets() concluído com sucesso.');
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configura os triggers time-based do projeto.
 * Execute manualmente UMA VEZ após o primeiro deploy.
 */
function setupTriggers() {
  // Remove todos os triggers existentes para evitar duplicatas
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // Automação principal — a cada 1 minuto
  ScriptApp.newTrigger('runAutomation')
    .timeBased()
    .everyMinutes(1)
    .create();

  // Relatório mensal — dia 1 de cada mês às 08h
  ScriptApp.newTrigger('sendMonthlyReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .create();

  Logger.log('Triggers configurados: runAutomation (1min) + sendMonthlyReport (mensal).');
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIOS POR E-MAIL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia alerta por e-mail para o responsável do sistema.
 */
function sendAlertEmail(subject, body) {
  try {
    var email = Session.getActiveUser().getEmail();
    MailApp.sendEmail(email, '[BANESTES Automação] ' + subject, body);
  } catch (e) {
    console.error('sendAlertEmail error: ' + e.message);
  }
}

/**
 * Envia relatório mensal consolidado via e-mail.
 * Chamado automaticamente pelo trigger no dia 1 de cada mês às 08h.
 */
function sendMonthlyReport() {
  var data     = getMonthlyConsumption();
  var savings  = data.savings.filter(function(v) { return v !== null; });
  var lastSav  = savings.length ? savings[savings.length - 1] : 0;
  var totalSav = savings.reduce(function(a, b) { return a + b; }, 0);

  var subject = 'Relatório Mensal de Automação — ' +
    Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MMMM/yyyy');

  var body =
    'Prezada equipe,\n\n' +
    'Segue o relatório mensal do Sistema de Automação Setorial BANESTES:\n\n' +
    '──────────────────────────────────────\n' +
    '  Indicadores do mês\n' +
    '──────────────────────────────────────\n' +
    '  • Economia no mês:        R$ ' + lastSav.toLocaleString('pt-BR') + '\n' +
    '  • Economia acumulada:     R$ ' + totalSav.toLocaleString('pt-BR') + '\n' +
    '  • Redução de consumo:     ~30%\n' +
    '  • Bloqueios automáticos:  ver aba Logs\n\n' +
    'Acesse o dashboard para visualizar todos os gráficos e histórico detalhado.\n\n' +
    'Atenciosamente,\n' +
    'Sistema de Automação BANESTES\n' +
    'Desenvolvido por Sergio Paulo de Andrade';

  sendAlertEmail(subject, body);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processa payload recebido via doPost (webhook IoT).
 */
function processWebhookPayload(payload) {
  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty('DEVICE_STATE') || 'null') || getDefaultState();

  var device   = payload.device;
  var watts    = parseFloat(payload.watts) || 0;
  var devState = payload.state;

  if (state.plugs[device] !== undefined) {
    state.plugs[device].watts = watts;
    state.plugs[device].on    = (devState === 'on');
    if (watts > 150) state.plugs[device].lastActiveMs = Date.now();

  } else {
    // Tenta localizar como AC (ex: device = "ac01", "ac03")
    var acMatch = device.match(/^ac(\d+)$/);
    if (acMatch) {
      var idx = parseInt(acMatch[1], 10) - 1;
      if (idx >= 0 && idx < state.acs.length) {
        state.acs[idx].on = (devState === 'on');
      }
    }
  }

  props.setProperty('DEVICE_STATE', JSON.stringify(state));
  logEvent(device, 'WEBHOOK_UPDATE', watts + 'W | ' + devState);

  return { device: device, processed: true };
}

/**
 * Constrói o objeto summary para o dashboard.
 */
function buildSummary(state) {
  var acsOn   = state.acs.filter(function(a) { return a.on; }).length;
  var acKw    = acsOn * CONFIG.AC_POWER_KW * CONFIG.AC_EFFICIENCY; // ~2.7 kW por unidade (LG 30000 BTU)
  var plugW   = (state.plugs.caf1.on ? (state.plugs.caf1.watts || 0) : 0) +
                (state.plugs.caf2.on ? (state.plugs.caf2.watts || 0) : 0);
  var totalKw = +(acKw + plugW / 1000).toFixed(2);

  return {
    totalKw:      totalKw,
    costToday:    calcCostToday(),
    savingsMonth: 1842,
    blocksToday:  countBlocksToday(),
    acsOn:        acsOn,
    acsTotal:     state.acs.length,
  };
}

function calcCostToday() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.CONSUMPTION_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return 127;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var data  = sheet.getDataRange().getValues().slice(1);
    var sum   = data
      .filter(function(r) { return new Date(r[0]) >= today; })
      .reduce(function(acc, r) { return acc + (parseFloat(r[4]) || 0); }, 0);
    return +(sum.toFixed(2)) || 127;
  } catch (e) { return 127; }
}

function countBlocksToday() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.LOG_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return 3;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var data  = sheet.getDataRange().getValues().slice(1);
    return data.filter(function(r) {
      return new Date(r[0]) >= today && r[2] && r[2].toString().indexOf('BLOQUEIO') >= 0;
    }).length || 3;
  } catch (e) { return 3; }
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO PADRÃO (MOCK)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o estado padrão simulado dos dispositivos.
 * Substitua pelas chamadas à API Tuya / leitura do Sheets em produção.
 */
function getDefaultState() {
  var now = Date.now();
  return {
    plugs: {
      caf1: { on: true,  watts: 1450, lastActiveMs: now,                   inactiveMin: 0  },
      caf2: { on: true,  watts: 82,   lastActiveMs: now - 22 * 60 * 1000,  inactiveMin: 22 },
      pico: { on: false, watts: 0,    blocked: true                                        },
    },
    acs: [
      { zone: 'Reunião', on: true,  temp: 23, autoOff: false },
      { zone: 'Reunião', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: false, temp: null, autoOff: true  },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão A', on: true,  temp: 23, autoOff: false },
      { zone: 'Salão B', on: false, temp: null, autoOff: true  },
      { zone: 'Salão B', on: false, temp: null, autoOff: true  },
      { zone: 'Salão B', on: false, temp: null, autoOff: true  },
      { zone: 'Salão B', on: false, temp: null, autoOff: true  },
      { zone: 'Copa',    on: false, temp: null, autoOff: false },
      { zone: 'Copa',    on: false, temp: null, autoOff: false },
    ],
    presence: {
      reuniao: true,
      salaoA:  true,
      salaoB:  false,
      copa:    true,
    },
  };
}

/**
 * Logs mockados para quando a planilha ainda não tem dados.
 */
function getMockLogs() {
  return [
    { timestamp: '14:12', device: 'pico',   event: 'BLOQUEIO_INTERLOCK',   value: 'Caf1=1450W', tag: 'block' },
    { timestamp: '14:10', device: 'caf1',   event: 'LIGADO',               value: '1450W',      tag: 'info'  },
    { timestamp: '13:50', device: 'caf2',   event: 'ALERTA_INATIVIDADE',   value: '22min',      tag: 'warn'  },
    { timestamp: '13:30', device: 'AC 06',  event: 'AUTO_OFF_SENSOR',      value: 'Salão A',    tag: 'save'  },
    { timestamp: '12:45', device: 'AC 11-14', event: 'AUTO_OFF_SENSOR',    value: 'Salão B',    tag: 'save'  },
    { timestamp: '10:02', device: 'pico',   event: 'DESBLOQUEIO_INTERLOCK',value: 'Caf1=0W',   tag: 'info'  },
    { timestamp: '09:32', device: 'pico',   event: 'BLOQUEIO_INTERLOCK',   value: 'Caf1=1510W', tag: 'block' },
    { timestamp: '08:15', device: 'caf1',   event: 'AUTO_OFF_INATIVIDADE', value: '30min',      tag: 'save'  },
  ];
}
