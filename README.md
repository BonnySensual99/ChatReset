# 🤖 Bot de Discord: Auto-Nuke Channel Daily

Bot automatizado para Discord en Node.js que **clona y elimina** automáticamente un canal de texto todos los días a las **00:00** para garantizar que ningún usuario nuevo pueda ver el historial anterior y prevenir filtraciones.

---

## 🛠️ Requisitos Previos

1. **Node.js** instalado (v16 o superior).
2. Un Bot creado en el **Discord Developer Portal**.

---

## 🚀 Paso 1: Configurar el Bot en Discord Developer Portal

1. Entra a [Discord Developer Portal](https://discord.com/developers/applications).
2. Haz clic en **New Application**, ponle un nombre (ej: `Channel Cleaner`) y crea la aplicación.
3. Ve al menú lateral **Bot**:
   - Haz clic en **Reset Token** para obtener el Token del bot. ¡Guárdalo bien!
4. Ve al menú lateral **OAuth2 -> URL Generator**:
   - En **Scopes**, marca: `bot`.
   - En **Bot Permissions**, marca:
     - `Manage Channels` (Administrar Canales)
     - `Send Messages` (Enviar Mensajes)
     - `View Channels` (Ver Canales)
   - Copia la URL generada abajo y ábrela en tu navegador para **invitar el Bot a tu servidor**.

---

## ⚙️ Paso 2: Instalación y Configuración del Código

1. Instala las dependencias necesarias abriendo una terminal en este proyecto:
   ```bash
   npm install discord.js node-cron dotenv
   ```

2. Crea un archivo llamado `.env` en la raíz del proyecto (puedes duplicar `.env.example`):
   ```env
   DISCORD_TOKEN=TuTokenDeDiscordAqui
   CHANNEL_NAME=nombre-de-tu-canal
   TIMEZONE=Europe/Madrid
   ```

### 💡 ¿Cómo obtener el ID del canal?
1. En Discord, ve a **Ajustes de Usuario -> Avanzado** y activa el **Modo Desarrollador**.
2. Haz clic derecho sobre el canal que deseas autolimpiar cada día y selecciona **Copiar ID del canal**.

---

## 🏁 Paso 3: Ejecutar el Bot

Ejecuta el siguiente comando para iniciar el bot:
```bash
npm start
```

El bot se quedará activo y **todos los días a las 00:00 (en tu zona horaria)**:
1. Clonará el canal manteniendo todos los permisos, posición y configuración.
2. Eliminará el canal viejo con todo su historial.
3. Mandará un aviso en el nuevo canal informando que fue limpiado.
