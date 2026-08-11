const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config();

// Crear el cliente del bot con intenciones necesarias para Canales, Mensajes y Estados de Voz
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Configuración de variables del canal diario
const TARGET_CHANNEL_NAME = process.env.CHANNEL_NAME || 'chat-diario';
const GUILD_ID = process.env.GUILD_ID;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 * * *';

// Configuración de TempVoice y Roles
const TEMP_VOICE_CREATOR_NAME = process.env.TEMP_VOICE_CREATOR_NAME || '➕ Crear Sala';
const ROLE_TRUSTED_NAME = process.env.ROLE_TRUSTED_NAME || 'trusted';
const ROLE_VERIFIED_NAME = process.env.ROLE_VERIFIED_NAME || 'verified';

// Mapa para rastrear los canales de voz temporales creados: ID_Canal -> ID_Creador
const activeTempChannels = new Map();

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
            console.error(`[ERROR] No se encontró ningún canal de texto con el nombre: "${TARGET_CHANNEL_NAME}"`);
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

// ==========================================
// 🔊 LÓGICA DE TEMPVOICE (CANALES TEMPORALES)
// ==========================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild;

    // 1. USUARIO ENTRA AL CANAL CREADOR DE TEMPVOICE
    if (newState.channel && newState.channel.name.toLowerCase() === TEMP_VOICE_CREATOR_NAME.toLowerCase()) {
        
        // REQUISITO: Solo los usuarios con el rol 'trusted' pueden crear un TempVoice
        const hasTrustedRole = member.roles.cache.some(role => role.name.toLowerCase() === ROLE_TRUSTED_NAME.toLowerCase());

        if (!hasTrustedRole) {
            try {
                // Desconectar al usuario del canal creador si no tiene el rol trusted
                await newState.disconnect();
                console.log(`[TEMPVOICE] ${member.user.tag} intentó crear canal pero no tiene el rol '${ROLE_TRUSTED_NAME}'.`);
            } catch (err) {
                console.error('[TEMPVOICE] Error desconectando usuario sin permisos:', err.message);
            }
            return;
        }

        // Buscar los roles para configurar permisos
        const verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === ROLE_VERIFIED_NAME.toLowerCase());
        const trustedRole = guild.roles.cache.find(r => r.name.toLowerCase() === ROLE_TRUSTED_NAME.toLowerCase());

        // Configuración de Permisos
        const permissionOverwrites = [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] // Oculto e inaccesible para todos por defecto
            }
        ];

        // REQUISITO: Que los usuarios verificados ('verified') puedan ver y entrar al canal
        if (verifiedRole) {
            permissionOverwrites.push({
                id: verifiedRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
            });
        } else {
            console.warn(`[TEMPVOICE] Advertencia: No se encontró el rol '${ROLE_VERIFIED_NAME}' en el servidor.`);
        }

        // Otorgar permisos completos al creador del canal (trusted)
        permissionOverwrites.push({
            id: member.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.MoveMembers
            ]
        });

        try {
            // Crear el canal de voz temporal en la misma categoría si existe
            const category = newState.channel.parent;
            const tempChannel = await guild.channels.create({
                name: `🔊 Sala de ${member.displayName}`,
                type: 2, // GUILD_VOICE
                parent: category ? category.id : null,
                permissionOverwrites: permissionOverwrites,
                reason: `TempVoice creado por ${member.user.tag}`
            });

            activeTempChannels.set(tempChannel.id, member.id);

            // Mover inmediatamente al usuario al nuevo canal creado
            await newState.setChannel(tempChannel);
            console.log(`[TEMPVOICE] Canal "${tempChannel.name}" creado con éxito para ${member.user.tag}.`);

        } catch (error) {
            console.error('[TEMPVOICE] Error al crear canal de voz temporal:', error);
        }
    }

    // 2. USUARIO SALE DE UN CANAL Y EL CANAL SE QUEDA VACÍO -> BORRAR CANAL
    if (oldState.channel && activeTempChannels.has(oldState.channel.id)) {
        const channelToCheck = oldState.channel;
        if (channelToCheck.members.size === 0) {
            try {
                activeTempChannels.delete(channelToCheck.id);
                await channelToCheck.delete('TempVoice vacío eliminado automáticamente.');
                console.log(`[TEMPVOICE] Canal vaciado "${channelToCheck.name}" eliminado automáticamente.`);
            } catch (err) {
                console.error('[TEMPVOICE] Error eliminando canal temporal vacío:', err.message);
            }
        }
    }
});

client.on('messageCreate', async (message) => {
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
    console.log(`🔊 TempVoice Activo: Creador "${TEMP_VOICE_CREATOR_NAME}"`);
    console.log(`   - Permiso de Creación: Rol '${ROLE_TRUSTED_NAME}'`);
    console.log(`   - Permiso de Visualización: Rol '${ROLE_VERIFIED_NAME}' (Double Counter)`);
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



