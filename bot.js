const { 
    Client, 
    GatewayIntentBits, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
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

// Mapa para rastrear los canales de voz temporales creados: ID_Canal -> { ownerId, controlMsgId }
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

// Función auxiliar para construir la botonera del panel de control de voz
function buildVoiceControlPanel() {
    const embed = new EmbedBuilder()
        .setTitle('⚙️ Panel de Control de Tu Sala de Voz')
        .setDescription('Usa los botones de abajo para administrar y personalizar tu canal temporal.')
        .setColor('#5865F2')
        .addFields(
            { name: '🔒 / 🔓 Privacidad', value: 'Bloquea o desbloquea tu sala', inline: true },
            { name: '✏️ Nombre', value: 'Cambia el nombre de tu canal', inline: true },
            { name: '👥 Límite', value: 'Cambia el límite de usuarios', inline: true }
        )
        .setFooter({ text: 'Solo el dueño de la sala puede usar estos botones' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('temp_lock')
            .setLabel('Bloquear (Privado)')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('temp_unlock')
            .setLabel('Desbloquear')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('temp_rename')
            .setLabel('Cambiar Nombre')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('temp_limit')
            .setLabel('Límite Usuarios')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
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
                await newState.disconnect();
                console.log(`[TEMPVOICE] ${member.user.tag} intentó crear canal pero no tiene el rol '${ROLE_TRUSTED_NAME}'.`);
            } catch (err) {
                console.error('[TEMPVOICE] Error desconectando usuario sin permisos:', err.message);
            }
            return;
        }

        const verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === ROLE_VERIFIED_NAME.toLowerCase());

        // Configuración de Permisos iniciales
        const permissionOverwrites = [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
            }
        ];

        if (verifiedRole) {
            permissionOverwrites.push({
                id: verifiedRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
            });
        }

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
            const category = newState.channel.parent;
            const tempChannel = await guild.channels.create({
                name: `🔊 Sala de ${member.displayName}`,
                type: 2, // GUILD_VOICE
                parent: category ? category.id : null,
                permissionOverwrites: permissionOverwrites,
                reason: `TempVoice creado por ${member.user.tag}`
            });

            // Enviar panel con botones de control dentro del chat de texto del canal de voz
            const panelData = buildVoiceControlPanel();
            const controlMessage = await tempChannel.send(panelData);

            activeTempChannels.set(tempChannel.id, {
                ownerId: member.id,
                controlMsgId: controlMessage.id
            });

            await newState.setChannel(tempChannel);
            console.log(`[TEMPVOICE] Canal "${tempChannel.name}" creado con éxito para ${member.user.tag}.`);

        } catch (error) {
            console.error('[TEMPVOICE] Error al crear canal de voz temporal:', error);
        }
    }

    // 2. USUARIO ENTRA A UN CANAL TEMPORAL BLOQUEADO (Eyectar incluso si tiene permisos de Admin)
    if (newState.channel && activeTempChannels.has(newState.channel.id)) {
        const channelData = activeTempChannels.get(newState.channel.id);
        const channel = newState.channel;
        
        // Si el usuario no es el dueño de la sala
        if (member.id !== channelData.ownerId) {
            // Verificar si el canal está bloqueado (Connect denegado para @everyone)
            const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
            const isLocked = everyoneOverwrite && everyoneOverwrite.deny.has(PermissionFlagsBits.Connect);

            if (isLocked) {
                try {
                    await newState.disconnect();
                    console.log(`[TEMPVOICE] ${member.user.tag} fue eyectado de la sala bloqueada de <@${channelData.ownerId}>.`);
                } catch (err) {
                    console.error('[TEMPVOICE] Error desconectando usuario de canal bloqueado:', err.message);
                }
                return;
            }
        }
    }

    // 3. USUARIO SALE DE UN CANAL Y EL CANAL SE QUEDA VACÍO -> BORRAR CANAL
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

// ==========================================
// 🕹️ INTERACCIÓN CON BOTONES Y MODALES
// ==========================================
client.on('interactionCreate', async (interaction) => {
    // Manejar Botones
    if (interaction.isButton()) {
        const channel = interaction.channel;
        if (!channel || !activeTempChannels.has(channel.id)) {
            return interaction.reply({ content: '❌ Este panel ya no está activo.', ephemeral: true });
        }

        const channelData = activeTempChannels.get(channel.id);

        // Verificar si quien pulsa es el dueño de la sala o Administrador
        if (interaction.user.id !== channelData.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Solo el creador de esta sala puede usar estos botones.', ephemeral: true });
        }

        const verifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === ROLE_VERIFIED_NAME.toLowerCase());

        // Botón Bloquear (Privado)
        if (interaction.customId === 'temp_lock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { Connect: false });
            if (verifiedRole) {
                await channel.permissionOverwrites.edit(verifiedRole.id, { Connect: false });
            }
            return interaction.reply({ 
                content: '🔒 **Sala bloqueada.** Nadie nuevo podrá unirse.\n*(Nota de Discord: Los administradores del servidor por arquitectura del propio Discord siempre tienen el permiso "Administrator" que bypassea las restricciones de canales).*', 
                ephemeral: true 
            });
        }


        // Botón Desbloquear (Público para verificados)
        if (interaction.customId === 'temp_unlock') {
            if (verifiedRole) {
                await channel.permissionOverwrites.edit(verifiedRole.id, { Connect: true, ViewChannel: true });
            }
            return interaction.reply({ content: '🔓 **Sala desbloqueada.** Los usuarios verificados pueden entrar de nuevo.', ephemeral: true });
        }

        // Botón Cambiar Nombre (Abre Modal)
        if (interaction.customId === 'temp_rename') {
            const modal = new ModalBuilder()
                .setCustomId('modal_temp_rename')
                .setTitle('Cambiar Nombre de la Sala');

            const nameInput = new TextInputBuilder()
                .setCustomId('input_temp_name')
                .setLabel('Nuevo nombre para el canal')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: Sala de Charlas')
                .setMaxLength(30)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            return interaction.showModal(modal);
        }

        // Botón Límite de Usuarios (Abre Modal)
        if (interaction.customId === 'temp_limit') {
            const modal = new ModalBuilder()
                .setCustomId('modal_temp_limit')
                .setTitle('Límite de Usuarios');

            const limitInput = new TextInputBuilder()
                .setCustomId('input_temp_limit')
                .setLabel('Número máximo de usuarios (0 para ilimitado)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: 5')
                .setMaxLength(2)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
            return interaction.showModal(modal);
        }
    }

    // Manejar Respuestas de Modales
    if (interaction.isModalSubmit()) {
        const channel = interaction.channel;
        if (!channel || !activeTempChannels.has(channel.id)) return;

        // Modal Cambiar Nombre
        if (interaction.customId === 'modal_temp_rename') {
            const newName = interaction.fields.getTextInputValue('input_temp_name');
            await channel.setName(`🔊 ${newName}`);
            return interaction.reply({ content: `✏️ Nombre del canal cambiado a: **🔊 ${newName}**`, ephemeral: true });
        }

        // Modal Límite de Usuarios
        if (interaction.customId === 'modal_temp_limit') {
            const limitStr = interaction.fields.getTextInputValue('input_temp_limit');
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit < 0 || limit > 99) {
                return interaction.reply({ content: '❌ Por favor ingresa un número válido entre 0 y 99.', ephemeral: true });
            }

            await channel.setUserLimit(limit);
            return interaction.reply({ content: `👥 Límite de usuarios establecido en: **${limit === 0 ? 'Sin límite' : limit}**`, ephemeral: true });
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
    console.log(`🔊 TempVoice Activo con PANEL DE BOTONES INTERACTIVO`);
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




