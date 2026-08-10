const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config();

// Crear el cliente del bot con los intenciones de Servidores
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Opción inteligente: Buscar canal por NOMBRE en lugar de un ID fijo
// así funciona automáticamente día tras día aunque el ID cambie al clonarlo.
const TARGET_CHANNEL_NAME = process.env.CHANNEL_NAME || 'chat-diario';
const GUILD_ID = process.env.GUILD_ID; // ID del servidor (opcional para ser más preciso)

async function nukeAndResetChannel() {
    try {
        let channel;

        // Si se configuró un GUILD_ID, buscamos directamente en ese servidor por el nombre del canal
        if (GUILD_ID) {
            const guild = await client.guilds.fetch(GUILD_ID);
            channel = guild.channels.cache.find(ch => ch.name === TARGET_CHANNEL_NAME && ch.isTextBased() && !ch.isThread());
        } else {
            // Buscar en todos los canales a los que el bot tiene acceso
            channel = client.channels.cache.find(ch => ch.name === TARGET_CHANNEL_NAME && ch.isTextBased() && !ch.isThread());
        }

        if (!channel) {
            console.error(`[ERROR] No se encontró ningún canal de texto con el nombre: "${TARGET_CHANNEL_NAME}"`);
            return;
        }

        console.log(`[${new Date().toLocaleString()}] Iniciando limpieza del canal "${channel.name}" (ID actual: ${channel.id})...`);

        // Guardar posición original
        const position = channel.position;

        // 1. Clonar el canal (el nuevo canal conservará el MISMO NOMBRE, permisos y categoría)
        const newChannel = await channel.clone({
            reason: 'Reinicio automático diario de canal para privacidad e historial limpio.'
        });

        // Restablecer la posición del nuevo canal
        await newChannel.setPosition(position);

        // Mensaje de aviso en el canal recién clonado
        await newChannel.send({
            content: '🧹 **Este canal ha sido limpiado automáticamente a las 00:00.** El historial anterior ha sido eliminado.'
        });

        // 2. Eliminar el canal viejo
        await channel.delete('Reinicio automático diario.');

        console.log(`[ÉXITO] Canal "${TARGET_CHANNEL_NAME}" reiniciado con éxito. El nuevo ID es: ${newChannel.id}`);

    } catch (error) {
        console.error('[ERROR] Hubo un fallo al intentar reiniciar el canal:', error);
    }
}

client.once('ready', () => {
    console.log(`========================================`);
    console.log(`Bot conectado exitosamente como: ${client.user.tag}`);
    console.log(`Zona horaria configurada: ${TIMEZONE}`);
    console.log(`========================================`);

    // Programar tarea Cron para las 00:00 todos los días ('0 0 * * *')
    cron.schedule('0 0 * * *', () => {
        console.log('⏰ Ejecutando limpieza programada de las 00:00...');
        nukeAndResetChannel();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
});

client.login(process.env.DISCORD_TOKEN);
