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

// Mapa para rastrear los canales de voz temporales creados: ID_Canal -> { ownerId, controlMsgId, trustedUsers: Set }
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
            { name: '✏️ Nombre', value: 'Cambia el nombre', inline: true },
            { name: '👥 Límite', value: 'Límite de usuarios', inline: true },
            { name: '⭐ Trust / Untrust', value: 'Permite/prohíbe el acceso a usuarios específicos', inline: false }
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
            .setLabel('Nombre')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('temp_trust')
            .setLabel('Dar Trust')
            .setEmoji('⭐')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('temp_untrust')
            .setLabel('Quitar Trust')
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('temp_limit')
            .setLabel('Límite')
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
                type: 2,
                parent: category ? category.id : null,
                permissionOverwrites: permissionOverwrites,
                reason: `TempVoice creado por ${member.user.tag}`
            });

            const panelData = buildVoiceControlPanel();
            const controlMessage = await tempChannel.send(panelData);

            activeTempChannels.set(tempChannel.id, {
                ownerId: member.id,
                controlMsgId: controlMessage.id,
                trustedUsers: new Set()
            });

            await newState.setChannel(tempChannel);
            console.log(`[TEMPVOICE] Canal "${tempChannel.name}" creado con éxito para ${member.user.tag}.`);

        } catch (error) {
            console.error('[TEMPVOICE] Error al crear canal de voz temporal:', error);
        }
    }

    // 2. CONTROL DE ENTRADA A CANALES TEMPORALES
    if (newState.channel && activeTempChannels.has(newState.channel.id)) {
        const channelData = activeTempChannels.get(newState.channel.id);
        const channel = newState.channel;
        
        // Si el usuario NO es el dueño de la sala
        if (member.id !== channelData.ownerId) {
            const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
            const isLocked = everyoneOverwrite && everyoneOverwrite.deny.has(PermissionFlagsBits.Connect);

            const isTrustedUser = channelData.trustedUsers.has(member.id);

            // SI EL CANAL ESTÁ BLOQUEADO (PRIVADO):
            if (isLocked) {
                // Eyectar si NO está en la lista de Trust de la sala
                if (!isTrustedUser) {
                    try {
                        await newState.disconnect();
                        console.log(`[TEMPVOICE] ${member.user.tag} (Admin/User) fue eyectado de la sala BLOQUEADA de <@${channelData.ownerId}> por no tener Trust.`);
                    } catch (err) {
                        console.error('[TEMPVOICE] Error desconectando usuario de canal bloqueado:', err.message);
                    }
                    return;
                }
            } 
            // SI EL CANAL ESTÁ PÚBLICO (DESBLOQUEADO):
            // Los Admins y usuarios verificados pueden estar y entrar libremente SIN ser eyectados.
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
    if (interaction.isButton()) {
        const channel = interaction.channel;
        if (!channel || !activeTempChannels.has(channel.id)) {
            return interaction.reply({ content: '❌ Este panel ya no está activo.', ephemeral: true });
        }

        const channelData = activeTempChannels.get(channel.id);

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

            // Eyectar a los usuarios presentes que no sean el dueño ni estén en la lista Trust
            channel.members.forEach(async (m) => {
                if (m.id !== channelData.ownerId && !channelData.trustedUsers.has(m.id)) {
                    try { await m.voice.disconnect(); } catch (e) {}
                }
            });

            return interaction.reply({ 
                content: '🔒 **Sala BLOQUEADA.** Ahora es totalmente privada. Solo tú y las personas con ⭐ Trust podrán entrar.', 
                ephemeral: true 
            });
        }

        // Botón Desbloquear (Público para verificados y admins)
        if (interaction.customId === 'temp_unlock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { Connect: null });
            if (verifiedRole) {
                await channel.permissionOverwrites.edit(verifiedRole.id, { Connect: true, ViewChannel: true });
            }
            return interaction.reply({ content: '🔓 **Sala PÚBLICA.** Los usuarios verificados y administradores pueden unirse libremente.', ephemeral: true });
        }

        // Botón Dar Trust (Pedir ID / Mención)
        if (interaction.customId === 'temp_trust') {
            const modal = new ModalBuilder()
                .setCustomId('modal_temp_trust')
                .setTitle('Dar Trust a un usuario');

            const userInput = new TextInputBuilder()
                .setCustomId('input_trust_user')
                .setLabel('ID de Usuario o Tag de Discord')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: 123456789012345678 o nombre')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));
            return interaction.showModal(modal);
        }

        // Botón Quitar Trust
        if (interaction.customId === 'temp_untrust') {
            const modal = new ModalBuilder()
                .setCustomId('modal_temp_untrust')
                .setTitle('Quitar Trust a un usuario');

            const userInput = new TextInputBuilder()
                .setCustomId('input_untrust_user')
                .setLabel('ID de Usuario a revocar')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: 123456789012345678')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));
            return interaction.showModal(modal);
        }

        // Botón Cambiar Nombre
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

        // Botón Límite de Usuarios
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

        const channelData = activeTempChannels.get(channel.id);

        // Modal Dar Trust
        if (interaction.customId === 'modal_temp_trust') {
            const targetInput = interaction.fields.getTextInputValue('input_trust_user').trim().replace(/[<@!>]/g, '');
            try {
                const targetMember = await interaction.guild.members.fetch(targetInput);
                if (targetMember) {
                    channelData.trustedUsers.add(targetMember.id);
                    await channel.permissionOverwrites.edit(targetMember.id, { Connect: true, ViewChannel: true });
                    return interaction.reply({ content: `⭐ Has otorgado **Trust** a **${targetMember.user.tag}**. Ahora puede entrar a tu sala aunque esté privada.`, ephemeral: true });
                }
            } catch (e) {
                return interaction.reply({ content: '❌ No se encontró ningún usuario con ese ID en el servidor.', ephemeral: true });
            }
        }

        // Modal Quitar Trust
        if (interaction.customId === 'modal_temp_untrust') {
            const targetInput = interaction.fields.getTextInputValue('input_untrust_user').trim().replace(/[<@!>]/g, '');
            if (channelData.trustedUsers.has(targetInput)) {
                channelData.trustedUsers.delete(targetInput);
                await channel.permissionOverwrites.delete(targetInput);

                // Si está dentro de la sala y está bloqueada, desconectarlo
                const everyoneOverwrite = channel.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id);
                const isLocked = everyoneOverwrite && everyoneOverwrite.deny.has(PermissionFlagsBits.Connect);
                
                if (isLocked) {
                    const memberInVoice = channel.members.get(targetInput);
                    if (memberInVoice) {
                        try { await memberInVoice.voice.disconnect(); } catch (err) {}
                    }
                }

                return interaction.reply({ content: `🚫 Has revocado el **Trust** a <@${targetInput}>.`, ephemeral: true });
            } else {
                return interaction.reply({ content: '❌ Ese usuario no está en tu lista de Trust.', ephemeral: true });
            }
        }

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




