const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config();

// Crear el cliente del bot con intenciones de Servidores y Mensajes (para pruebas)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Configuración de variables
const TARGET_CHANNEL_NAME = process.env.CHANNEL_NAME || 'chat-diario';
const GUILD_ID = process.env.GUILD_ID;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';

// Expresión Cron (por defecto 00:00 -> '0 0 * * *')
// Ejemplo para minutos específicos: '*/5 * * * *' (cada 5 min) o '30 14 * * *' (a las 14:30)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 * * *';

async function nukeAndResetChannel() {
    try {
        let channel;

        if (GUILD_ID) {
            const guild = await client.guilds.fetch(GUILD_ID);
            channel = guild.channels.cache.find(ch => ch.name === TARGET_CHANNEL_NAME && ch.isTextBased() && !ch.isThread());
        } else {
            channel = client.channels.cache.find(ch => ch.name === TARGET_CHANNEL_NAME && ch.isTextBased() && !ch.isThread());
        }

        if (!channel) {
            console.error(`[ERROR] No se encontró ningún canal con el nombre: "${TARGET_CHANNEL_NAME}"`);
            return;
        }

        console.log(`[${new Date().toLocaleString()}] Iniciando limpieza del canal "${channel.name}"...`);

        const position = channel.position;

        const newChannel = await channel.clone({
            reason: 'Reinicio de canal para privacidad e historial limpio.'
        });

        await newChannel.setPosition(position);

        await newChannel.send({
            content: '🧹 **Este canal ha sido limpiado automáticamente.** El historial anterior ha sido eliminado.'
        });

        await channel.delete('Reinicio de canal.');

        console.log(`[ÉXITO] Canal "${TARGET_CHANNEL_NAME}" reiniciado con éxito.`);

    } catch (error) {
        console.error('[ERROR] Hubo un fallo al intentar reiniciar el canal:', error);
    }
}

client.on('messageCreate', async (message) => {
    // Comando manual para probar la limpieza inmediatamente en Discord (!nuke)
    if (message.content.toLowerCase() === '!nuke') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
        }
        await message.reply('⚡ Ejecutando prueba de nuke manual...');
        await nukeAndResetChannel();
    }
});

client.once('ready', () => {
    console.log(`========================================`);
    console.log(`Bot conectado exitosamente como: ${client.user.tag}`);
    console.log(`Zona horaria: ${TIMEZONE}`);
    console.log(`Horario programado (Cron): ${CRON_SCHEDULE}`);
    console.log(`💡 TRUCO DE PRUEBAS: Escribe "!nuke" en cualquier canal para probar la limpieza de inmediato.`);
    console.log(`========================================`);

    cron.schedule(CRON_SCHEDULE, () => {
        console.log('⏰ Ejecutando limpieza programada...');
        nukeAndResetChannel();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
});

client.login(process.env.DISCORD_TOKEN);

