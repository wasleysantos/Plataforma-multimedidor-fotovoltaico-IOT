# ⚡ Tesla Solar – Multimedidor de Geração e Consumo

Projeto de **monitoramento de geração e consumo de energia solar**, integrando **hardware (IoT)** e **plataforma web**, com foco em visualização clara de dados, comunicação eficiente e arquitetura escalável.

<img width="1024" height="1536" alt="Arquitetura Tesla Solar" src="https://github.com/user-attachments/assets/53cf40e0-213a-49ba-a661-dfae61d95dcb" />


Desenvolvido como projeto acadêmico no **IFMA**, em parceria com a **Tesla Energia Solar**.

---

## 📌 Visão Geral do Projeto

Sistema completo composto por:

* 📟 **Multimedidor fotovoltaico** para leitura de variáveis elétricas
* 🌐 **Comunicação IoT via Wi-Fi**
* 📊 **Dashboard Web responsivo** para visualização em tempo real e histórico

O sistema permite acompanhar de forma intuitiva:

* Geração de energia solar
* Consumo energético
* Histórico de medições
* Estado do sistema e dispositivos conectados

---

## 🧠 Arquitetura do Sistema

O fluxo geral do sistema é composto pelas seguintes etapas:

1. Medição das variáveis elétricas
2. Processamento dos dados no microcontrolador
3. Envio das medições via Wifi
4. Recepção dos dados no Supabase(backend)
5. Visualização em dashboards e gráficos interativos na aplicação Web

**Componentes principais:**

* Painéis solares
* Inversor On-Grid
* Sensor de medição (PZEM-004T)
* Microcontrolador ESP8266
* Interface Web
  
---

## ⚙️ Medição de Variáveis Elétricas

O sistema utiliza o **módulo PZEM-004T**, responsável por medir:

* ⚡ Tensão
* 🔌 Corrente
* 🔋 Potência
* ⚙️ Energia acumulada

📡 **Protocolos utilizados:**

* Modbus RTU
* UART

O módulo suporta medições de corrente de até **100A**, sendo adequado para aplicações residenciais e educacionais .

---

### 📶 Meio Físico

A comunicação é realizada via **Wi-Fi**, utilizando roteador local, por apresentar:

* Baixo custo
* Infraestrutura amplamente disponível
* Menor consumo energético que soluções GSM
* Simplicidade de instalação (plug and play)

---

## 🌐 Plataforma Web

A interface Web foi desenvolvida para oferecer:

* 📊 Dashboard com visualização intuitiva
* 📈 Gráficos dinâmicos e interativos
* 🕒 Histórico detalhado de consumo e geração
* 📱 Interface moderna e totalmente responsiva
* 🔌 Visualização dos dispositivos conectados

---

## 🛠️ Tecnologias Utilizadas

### Frontend

* **React.js**
* **TypeScript**
* **Tailwind CSS**

### IoT / Comunicação

* **ESP8266**
* **SUPABASE**
* **Modbus RTU**
* **UART**
* **Wi-Fi**

Essas tecnologias garantem **performance, escalabilidade, acessibilidade e boa experiência do usuário** .

---

## 🚀 Como Executar o Projeto Web

### 1️⃣ Pré-requisitos

* Node.js (versão LTS)
* npm 

### 2️⃣ Instalação

```bash
npm install
```

### 3️⃣ Executar em ambiente de desenvolvimento

```bash
npm run dev
```

Acesse no navegador:

```
http://localhost:3000
```

---

## 📱 Responsividade

O layout foi projetado para funcionar perfeitamente em:

* 💻 Desktop
* 📱 Mobile

---

## 👨‍💻 Autores

* **Wasley Santos**
* Ayrton Silva
* João Jesus

---

📚 Projeto desenvolvido para fins acadêmicos no **Instituto Federal do Maranhão (IFMA)**, em parceria com a **Tesla Energia Solar**.

![WhatsApp Image 2026-02-07 at 20 00 25](https://github.com/user-attachments/assets/3d7c8f84-f69e-45c8-ae94-ef4ebe7ceaf6)


