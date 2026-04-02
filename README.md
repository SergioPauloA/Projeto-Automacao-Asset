# BANESTES · Sistema de Automação Setorial

> **Status:** ⚠️ Modo MOCK — hardware ainda não instalado. Todos os dados são simulados.  
> Desenvolvido por **Sergio Paulo de Andrade**

---

## 📋 Sumário

1. [Objetivo](#objetivo)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Funcionalidades](#funcionalidades)
4. [Estrutura de Arquivos](#estrutura-de-arquivos)
5. [Como Implantar no Google Apps Script](#como-implantar-no-google-apps-script)
6. [Opções de Integração com Hardware](#opções-de-integração-com-hardware)
7. [Hardware Necessário](#hardware-necessário)
8. [Dashboard](#dashboard)
9. [Automações Implementadas](#automações-implementadas)
10. [ROI Esperado](#roi-esperado)

---

## Objetivo

Implementar um sistema de automação inteligente para o setor do Banestes, visando:

- **Redução de custos** com energia elétrica (meta: 25%–35%)
- **Controle centralizado** de 16 ares-condicionados LG via Hub IR Zigbee
- **Gestão de carga** da copa com Smart Plugs 20A e intertravamento automático
- **Dashboard gerencial** acessível via navegador, construído sobre Google Apps Script (custo zero de hospedagem)
- **Auditoria contínua** com registros automáticos no Google Sheets

---

## Arquitetura do Sistema

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HARDWARE (Local)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  ┌────────────┐  │
│  │  16 ACs LG  │  │ 4 Hubs IR    │  │ 3 Smart   │  │ 4 Sensores │  │
│  │             │◄─│ Zigbee       │  │ Plugs 20A │  │ Presença   │  │
│  └─────────────┘  └──────┬───────┘  └─────┬─────┘  └─────┬──────┘  │
│                           └────────────────┴──────────────┘          │
│                                      │                                │
│                           ┌──────────▼─────────┐                    │
│                           │  Gateway Zigbee 3.0 │                    │
│                           │  (RJ45 Ethernet)    │                    │
│                           └──────────┬──────────┘                    │
└──────────────────────────────────────┼───────────────────────────────┘
                                       │ HTTP POST (JSON)
                           ┌───────────▼──────────────┐
                           │   Google Apps Script      │
                           │   doPost() — Webhook      │
                           │   runAutomation() — 1min  │
                           └───────────┬──────────────┘
                         ┌─────────────┴────────────────┐
                         │                              │
              ┌──────────▼──────────┐      ┌───────────▼──────────┐
              │   Google Sheets     │      │   Web App (Dashboard) │
              │   • Logs            │      │   HTML + JavaScript   │
              │   • Consumo         │      │   Acesso via URL      │
              │   • Dispositivos    │      └──────────────────────┘
              └─────────────────────┘
```

### Fluxo de Dados (Opção 1 — API Cloud Tuya)

```
Dispositivo → Gateway → Cloud Tuya → Apps Script → Google Sheets
```

### Fluxo de Dados (Opção 2 — Gateway Local / Zigbee2MQTT)

```
Dispositivo → Gateway Local → HTTP POST → Apps Script → Google Sheets
```

---

## Funcionalidades

### ✅ Implementadas (simuladas em modo mock)

| Funcionalidade | Descrição |
|---|---|
| **Dashboard em tempo real** | Visão geral de consumo, status dos ACs e tomadas |
| **Intertravamento automático** | Cafeteira 1 > 1.000W → bloqueia a Picotadora |
| **Auto-off por inatividade** | Cafeteiras desligam após 30 min em standby |
| **Auto-off às 18h** | Todos os ACs desligam automaticamente |
| **Auto-off por ausência** | Sensores de presença disparam desligamento de ACs |
| **Botão de emergência** | Desliga todos os dispositivos simultaneamente |
| **Log de eventos** | Registro de todos os eventos no Google Sheets |
| **Relatório mensal** | E-mail automático com resumo de economia e ROI |
| **Webhook receiver** | `doPost()` recebe dados IoT em tempo real |
| **Comparativo de consumo** | Gráficos Antes × Depois da automação |

### 🔲 Pendentes (requerem hardware instalado)

- Integração real com API Tuya / Zigbee2MQTT
- Leitura de watts em tempo real dos Smart Plugs
- Detecção de presença via sensores mmWave
- Controle IR dos ares-condicionados
- Exportação de relatório PDF via Looker Studio

---

## Estrutura de Arquivos

```
Projeto-Automacao-Asset/
│
├── Code.gs                                   # Backend Google Apps Script
│   ├── doGet()                               # Serve o Web App
│   ├── doPost()                              # Webhook IoT receiver
│   ├── getDashboardData()                    # API de estado dos dispositivos
│   ├── togglePlug() / toggleAc()            # Controle manual
│   ├── emergencyOffAll()                     # Desligamento geral
│   ├── getLogs() / getMonthlyConsumption()   # Dados históricos
│   ├── runAutomation()                       # Orquestrador (trigger 1min)
│   ├── ruleAutoOffAt18h()                    # Regra: desligamento 18h
│   ├── ruleInactivityOff()                   # Regra: inatividade cafeteiras
│   ├── ruleInterlock()                       # Regra: intertravamento
│   ├── logEvent() / updateConsumptionSheet() # Persistência Sheets
│   ├── setupSheets()                         # Inicialização (executar 1x)
│   ├── setupTriggers()                       # Configurar triggers (executar 1x)
│   └── sendMonthlyReport()                   # Relatório mensal por e-mail
│
├── banestes_asset_management_dashboard.html  # Frontend Web App
│   ├── Tab: Visão Geral                      # KPIs + plugs + ACs + log
│   ├── Tab: Tomadas Inteligentes             # Detalhes cafeteiras + picotadora
│   ├── Tab: Climatização                     # Mapa 16 ACs + sensores
│   └── Tab: Comparativos                     # Gráficos Antes × Depois
│
└── README.md                                 # Esta documentação
```

---

## Como Implantar no Google Apps Script

### Passo 1 — Criar o projeto

1. Acesse [script.google.com](https://script.google.com) com sua conta Google corporativa.
2. Clique em **Novo projeto**.
3. Renomeie o projeto para `BANESTES-Automacao-Setorial`.

### Passo 2 — Criar os arquivos

1. No editor, renomeie o arquivo padrão `Code.gs` e cole o conteúdo de `Code.gs` deste repositório.
2. Clique em **+** → **HTML** → nomeie como `banestes_asset_management_dashboard`.
3. Cole o conteúdo de `banestes_asset_management_dashboard.html`.

### Passo 3 — Vincular a uma Planilha Google

1. No editor, clique em **Recursos** → **Serviços do Google avançados** (ou acesse via Configurações do projeto → Planilha vinculada).
2. Abra a planilha e copie o ID da URL: `https://docs.google.com/spreadsheets/d/**SEU_ID**/edit`.
3. No `Code.gs`, ajuste a chamada `SpreadsheetApp.getActiveSpreadsheet()` ou use `SpreadsheetApp.openById('SEU_ID')` se necessário.

### Passo 4 — Configuração inicial (execute uma vez)

No editor, execute as funções abaixo **uma única vez** (menu **Executar**):

```
1. setupSheets()    → cria as abas Logs, Consumo, Dispositivos com cabeçalhos
2. setupTriggers()  → configura runAutomation (1 min) + sendMonthlyReport (mensal)
```

### Passo 5 — Publicar o Web App

1. **Implantar** → **Nova implantação** → tipo: **Web App**.
2. Execute como: **Eu mesmo**.
3. Quem tem acesso: **Todos** (ou restringir ao domínio corporativo).
4. Copie a URL gerada — este é o link do dashboard.

### Passo 6 — Configurar recebimento de webhooks

A URL do `doPost` é a mesma do Web App com `?` removido. Use-a no:
- Portal Tuya IoT (campo Webhook URL)
- Configuração HTTP do Zigbee2MQTT
- Módulo HTTP do Make.com / IFTTT

---

## Opções de Integração com Hardware

### Opção 1 — API Cloud Tuya ⭐ Recomendada para MVP

| | |
|---|---|
| **Custo de software** | R$ 0,00 (plano IoT Core gratuito) |
| **Implementação** | Rápida (~2 dias) |
| **Segurança** | Dados passam pela nuvem Tuya |
| **Hardware** | Gateway Zigbee Wi-Fi + dispositivos Tuya |

**Como configurar:**
1. Criar conta em [iot.tuya.com](https://iot.tuya.com).
2. Criar projeto IoT, obter `Access ID` e `Access Secret`.
3. No `Code.gs`, implementar `callTuyaApi()` usando `UrlFetchApp`.
4. Configurar webhook do projeto Tuya apontando para a URL do `doPost`.

### Opção 2 — Gateway Local / Zigbee2MQTT ⭐ Recomendada para banco

| | |
|---|---|
| **Custo de software** | R$ 0,00 (open source) |
| **Custo de hardware** | R$ 500–1.200 (adaptador USB + servidor) |
| **Implementação** | Moderada (~1 semana) |
| **Segurança** | Dados nunca saem da rede interna |

**Como configurar:**
1. Instalar Zigbee2MQTT em servidor interno (ou VM).
2. Configurar `http.js` para enviar POST à URL do Apps Script.
3. O `doPost()` em `Code.gs` já está pronto para receber.

### Opção 3 — Make.com (MVP Rápido)

| | |
|---|---|
| **Custo de software** | Gratuito até 1.000 ops/mês |
| **Implementação** | Muito rápida (~horas) |
| **Limitação** | Dependência de serviço SaaS externo |

---

## Hardware Necessário

| Qtd | Item | Especificação | Opção Recomendada |
|:---:|---|---|---|
| 1 | Gateway Zigbee 3.0 | Porta Ethernet RJ45 | Zemismart (RJ45) |
| 4 | Hub IR Zigbee | Controla ACs via infravermelho | MoesHouse Zigbee+RF |
| 3 | Smart Plug 20A | Com medição de consumo em watts | Aubess 20A c/ Monitor |
| 4 | Sensor de Presença | mmWave para detecção precisa | Zemismart mmWave |

> **Dica técnica:** O Gateway com porta RJ45 (Ethernet) é essencial em ambiente bancário — evita tráfego na rede Wi-Fi corporativa e aumenta a estabilidade e segurança.

### Distribuição dos Hubs IR

| Local | Qtd Hubs | ACs Cobertos |
|---|:---:|:---:|
| Sala de Reunião | 1 | AC 01–02 |
| Salão Principal (A) | 2 | AC 03–10 |
| Salão Principal (B) + Copa | 1 | AC 11–16 |

---

## Dashboard

O dashboard é um **Web App** servido pelo Google Apps Script, acessível em qualquer navegador sem instalação.

### Abas disponíveis

#### 🏠 Visão Geral
- KPIs: consumo total (kW), custo do dia (R$), economia do mês e bloqueios
- Status em tempo real das 3 tomadas da copa
- Mapa resumido dos 16 ACs
- Log de eventos das últimas horas
- Gráfico de consumo nas últimas 12h

#### 🔌 Tomadas Inteligentes
- Detalhamento de Cafeteira 1: potência, ciclos de uso, kWh do dia
- Detalhamento de Cafeteira 2: potência, progresso do countdown de inatividade
- Histórico de bloqueios da Picotadora

#### ❄️ Climatização
- KPIs dos 16 ACs (ligados, consumo, auto-offs)
- Mapa interativo: clique em qualquer AC para ligar/desligar
- Status dos 4 sensores de presença por zona
- Gráfico de consumo por área (kWh)

#### 📊 Comparativos
- Gráficos mensais: consumo e custo com vs sem automação
- Visão anual multi-ano
- Gráfico Antes × Depois da automação
- Tabela resumo com economia e ROI mês a mês

### Comportamento offline / mock

O dashboard funciona **completamente sem o servidor** quando aberto como arquivo HTML puro. Todos os dados são simulados localmente via JavaScript (`MOCK_STATE`, `MOCK_LOGS`). Ao publicar no Apps Script, a conexão com o servidor é automática via `google.script.run`.

---

## Automações Implementadas

### Regra 1 — Desligamento 18h
```
Todo dia às 18:00 → Todos os ACs recebem comando OFF
→ Notificação por e-mail enviada ao responsável
```

### Regra 2 — Inatividade das Cafeteiras
```
Cafeteira com watts < 150W por 30 minutos consecutivos
→ Desligamento automático + log no Sheets
```

### Regra 3 — Intertravamento Picotadora
```
SE Cafeteira 1 em uso E consumo > 1.000W
→ Tomada da Picotadora BLOQUEADA (sobrecarga elétrica prevenida)
SE Cafeteira 1 desligada
→ Tomada da Picotadora LIBERADA
```

### Trigger de automação
```
runAutomation() executa a cada 1 minuto:
  ├── ruleAutoOffAt18h()
  ├── ruleInactivityOff()
  ├── ruleInterlock()
  └── updateConsumptionSheet()
```

---

## ROI Esperado

| Indicador | Valor |
|---|---|
| Redução de consumo estimada | 25% a 35% |
| Economia mensal estimada (kWh) | ~6.800 kWh |
| Economia mensal em R$ | R$ 1.800 – R$ 2.800 |
| Payback do hardware | 3–6 meses |
| Custo de software/hospedagem | **R$ 0,00** |

> O investimento é concentrado apenas no hardware (única vez). Todo o software, banco de dados, dashboard e relatórios rodam sobre a infraestrutura Google que o banco já possui.

---

## Fórmula de Cálculo de Consumo

$$E = P \cdot \Delta t$$

Onde:
- **E** = Energia consumida (kWh)
- **P** = Potência (kW)
- **Δt** = Tempo de operação (horas)

Custo em R$: `E × tarifa (R$/kWh)` — tarifa ajustável em `CONFIG.TARIFF_RS_KWH` no `Code.gs`.

---

*Sistema desenvolvido por Sergio Paulo de Andrade — BANESTES Asset Management*
