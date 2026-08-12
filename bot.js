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
    TextInputStyle,
    UserSelectMenuBuilder
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

// Función auxiliar para construir la botonera del panel de control de voz con diseño elegante y premium
function buildVoiceControlPanel(ownerDisplayName) {
    const embed = new EmbedBuilder()
        .setTitle('✨ CENTRO DE CONTROL DE SALA TEMPORAL')
        .setDescription(`¡Hola **${ownerDisplayName}**! Bienvenido a tu panel de administración. Usa las herramientas interactivas de abajo para gestionar la privacidad, visibilidad y accesos a tu sala.`)
        .setColor('#5865F2')
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/565/565547.png')
        .addFields(
            { 
                name: '🔒  Privacidad & Acceso', 
                value: '> 🔒 **Bloquear:** Cierra el canal (solo creador/trusted).\n> 🔓 **Desbloquear:** Abre la sala a usuarios verificados.', 
                inline: false 
            },
            { 
                name: '👁️  Visibilidad en el Servidor', 
                value: '> 🙈 **Ocultar:** Esconde la sala de la lista de canales.\n> 👁️ **Mostrar:** Vuelve a hacer visible la sala.', 
                inline: false 
            },
            { 
                name: '⚙️  Ajustes & Lista VIP', 
                value: '> ✏️ **Nombre:** Renombra tu sala de voz.\n> ⭐ **Dar Trust:** Autoriza a un usuario específico.\n> 🚫 **Quitar Trust:** Revoca el acceso a un usuario.\n> 👥 **Límite:** Ajusta el cupo máximo de personas.', 
                inline: false 
            }
        )
        .setFooter({ text: '🛡️ Sistema de Gestión de Voz Privada • Solo el creador tiene acceso', iconURL: 'https://cdn-icons-png.flaticon.com/512/1067/1067735.png' })
        .setTimestamp();

    // Fila 1: Control de Privacidad y Visibilidad
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('temp_lock')
            .setLabel('Bloquear')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('temp_unlock')
            .setLabel('Desbloquear')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('temp_hide')
            .setLabel('Ocultar')
            .setEmoji('🙈')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('temp_show')
            .setLabel('Mostrar')
            .setEmoji('👁️')
            .setStyle(ButtonStyle.Secondary)
    );

    // Fila 2: Personalización y Sistema de Trust
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('temp_rename')
            .setLabel('Nombre')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('temp_trust')
            .setLabel('Dar Trust')
            .setEmoji('⭐')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('temp_untrust')
            .setLabel('Quitar Trust')
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('temp_limit')
            .setLabel('Límite')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Primary)
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

        // Configuración de Permisos iniciales: PÚBLICO POR DEFECTO para verificados
        const permissionOverwrites = [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.Connect] // Inaccesible por defecto a @everyone (no verificados)
            }
        ];

        if (verifiedRole) {
            permissionOverwrites.push({
                id: verifiedRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] // Público para verificados
            });
        }

        // Permisos completos explícitos para el Creador de la Sala
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

            const panelData = buildVoiceControlPanel(member.displayName);
            const controlMessage = await tempChannel.send(panelData);

            // Registrar inmediatamente el canal activo antes de mover al usuario
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
        const verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === ROLE_VERIFIED_NAME.toLowerCase());
        
        // SEGURIDAD: Jamás eyectar al CREADOR/DUENO del canal bajo ninguna circunstancia
        if (member.id !== channelData.ownerId) {
            const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
            const verifiedOverwrite = verifiedRole ? channel.permissionOverwrites.cache.get(verifiedRole.id) : null;
            
            // Un canal se considera BLOQUEADO/PRIVADO solo si se ha denegado Connect explícitamente a @everyone y/o verified
            const isLockedForEveryone = everyoneOverwrite && everyoneOverwrite.deny.has(PermissionFlagsBits.Connect);
            const isLockedForVerified = verifiedOverwrite && verifiedOverwrite.deny.has(PermissionFlagsBits.Connect);

            const isLocked = isLockedForEveryone && (verifiedOverwrite ? isLockedForVerified : true);
            const isTrustedUser = channelData.trustedUsers.has(member.id);

            // Solo eyectar si la sala está activamente BLOQUEADA y el usuario NO tiene Trust
            if (isLocked && !isTrustedUser) {
                try {
                    await newState.disconnect();
                    console.log(`[TEMPVOICE] ${member.user.tag} fue eyectado de la sala BLOQUEADA de <@${channelData.ownerId}>.`);
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

        // Botón Ocultar (Invisible)
        if (interaction.customId === 'temp_hide') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: false });
            if (verifiedRole) {
                await channel.permissionOverwrites.edit(verifiedRole.id, { ViewChannel: false });
            }
            return interaction.reply({ content: '🙈 **Sala OCULTA.** Tu canal de voz ahora es totalmente invisible en la lista para los demás usuarios.', ephemeral: true });
        }

        // Botón Mostrar (Visible)
        if (interaction.customId === 'temp_show') {
            if (verifiedRole) {
                await channel.permissionOverwrites.edit(verifiedRole.id, { ViewChannel: true });
            } else {
                await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: true });
            }
            return interaction.reply({ content: '👁️ **Sala VISIBLE.** Tu canal de voz vuelve a aparecer en la lista de canales.', ephemeral: true });
        }


        // Botón Dar Trust (Desplegable interactivo de usuarios de Discord)
        if (interaction.customId === 'temp_trust') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('select_temp_trust')
                .setPlaceholder('Selecciona el usuario para darle Trust...')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(userSelect);
            return interaction.reply({
                content: '⭐ **Selecciona el usuario al que deseas dar permisos (Trust):**',
                components: [row],
                ephemeral: true
            });
        }

        // Botón Quitar Trust (Desplegable interactivo)
        if (interaction.customId === 'temp_untrust') {
            if (channelData.trustedUsers.size === 0) {
                return interaction.reply({ content: '❌ Tu lista de Trust está actualmente vacía.', ephemeral: true });
            }

            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('select_temp_untrust')
                .setPlaceholder('Selecciona el usuario para quitarle el Trust...')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(userSelect);
            return interaction.reply({
                content: '🚫 **Selecciona el usuario al que deseas revocar el Trust:**',
                components: [row],
                ephemeral: true
            });
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

    // Manejar Desplegable de Selección de Usuarios (UserSelectMenu)
    if (interaction.isUserSelectMenu()) {
        const channel = interaction.channel;
        if (!channel || !activeTempChannels.has(channel.id)) return;

        const channelData = activeTempChannels.get(channel.id);
        const selectedUserId = interaction.values[0];
        const selectedUser = interaction.users.get(selectedUserId);

        // Selección para Dar Trust
        if (interaction.customId === 'select_temp_trust') {
            channelData.trustedUsers.add(selectedUserId);
            await channel.permissionOverwrites.edit(selectedUserId, { Connect: true, ViewChannel: true });
            return interaction.update({
                content: `⭐ Has otorgado **Trust** a **${selectedUser ? selectedUser.tag : selectedUserId}**. Ahora puede entrar a tu sala aunque esté privada.`,
                components: []
            });
        }

        // Selección para Quitar Trust
        if (interaction.customId === 'select_temp_untrust') {
            if (channelData.trustedUsers.has(selectedUserId)) {
                channelData.trustedUsers.delete(selectedUserId);
                await channel.permissionOverwrites.delete(selectedUserId);

                const everyoneOverwrite = channel.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id);
                const isLocked = everyoneOverwrite && everyoneOverwrite.deny.has(PermissionFlagsBits.Connect);
                
                if (isLocked) {
                    const memberInVoice = channel.members.get(selectedUserId);
                    if (memberInVoice) {
                        try { await memberInVoice.voice.disconnect(); } catch (err) {}
                    }
                }

                return interaction.update({
                    content: `🚫 Has revocado el **Trust** a **${selectedUser ? selectedUser.tag : selectedUserId}**.`,
                    components: []
                });
            } else {
                return interaction.update({
                    content: `❌ **${selectedUser ? selectedUser.tag : selectedUserId}** no estaba en tu lista de Trust.`,
                    components: []
                });
            }
        }
    }

    // Manejar Respuestas de Modales
    if (interaction.isModalSubmit()) {
        const channel = interaction.channel;
        if (!channel || !activeTempChannels.has(channel.id)) return;

        const channelData = activeTempChannels.get(channel.id);

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
    if (message.author.bot) return;

    // Comando !join (Notificar entrada a la cuenta de Valorant)
    if (message.content.toLowerCase() === '!join') {
        try {
            // Eliminar el mensaje del usuario (!join) para mantener limpio el canal
            try { await message.delete(); } catch (e) {}

            // Obtener la hora actual formateada en la zona horaria del bot (HH:MM)
            const hora = new Date().toLocaleTimeString('es-ES', { 
                timeZone: TIMEZONE, 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });

            // Enviar el aviso con el formato exacto: [hora] @usuario joined in the account.
            await message.channel.send(`[${hora}] <@${message.author.id}> joined in the account.`);
            console.log(`[VALORANT] ${message.author.tag} notificó entrada a la cuenta a las ${hora}.`);

        } catch (error) {
            console.error('[ERROR] Fallo al procesar el comando !join:', error);
        }
        return;
    }

    // Comando !nuke (Limpieza manual de canal)
    if (message.content.toLowerCase() === '!nuke') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
        }

        const channelToNuke = message.channel;

        if (!channelToNuke.isTextBased() || channelToNuke.isThread()) {
            return message.reply('❌ Este comando solo se puede usar en canales de texto estándar.');
        }

        try {
            console.log(`[${new Date().toLocaleString()}] !nuke ejecutado manualmente en "${channelToNuke.name}" por ${message.author.tag}...`);

            const position = channelToNuke.position;

            const newChannel = await channelToNuke.clone({
                reason: `Nuke manual ejecutado por ${message.author.tag}`
            });

            await newChannel.setPosition(position);

            await newChannel.send({
                content: '🧹 **Este canal ha sido limpiado manualmente.** El historial anterior ha sido eliminado.'
            });

            await channelToNuke.delete(`Nuke manual ejecutado por ${message.author.tag}`);

            console.log(`[ÉXITO] Canal "${newChannel.name}" reiniciado con !nuke.`);

        } catch (error) {
            console.error('[ERROR] Hubo un fallo al intentar ejecutar !nuke:', error);
        }
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




