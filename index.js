const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require("discord.js");
const fs = require("fs");
const http = require("http");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = "!";
const LOG_CHANNEL_ID = "1479173067212193954";

let db = { users: {} };

if (fs.existsSync("./database.json")) {
  db = JSON.parse(fs.readFileSync("./database.json"));
}

function saveDB() {
  fs.writeFileSync("./database.json", JSON.stringify(db, null, 2));
}

function getUser(id) {
  if (!db.users[id]) {
    db.users[id] = { bank: 0, holding: 0, pending: 0, holdingData: [] };
    saveDB();
  }
  if (!db.users[id].holdingData) db.users[id].holdingData = [];
  return db.users[id];
}

client.once("ready", () => {
  console.log(`Bot Ready: ${client.user.tag}`);
});

// AUTO TRANSFER - holding to bank after 2 hours
setInterval(() => {
  const now = Date.now();
  for (let id in db.users) {
    let user = db.users[id];
    if (user.holdingData) {
      user.holdingData = user.holdingData.filter(item => {
        if (now >= item.time) {
          user.bank += item.amount;
          user.holding -= item.amount;
          return false;
        }
        return true;
      });
    }
  }
  saveDB();
}, 60000);

// ATM DROPDOWN - TICKET CREATE
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "atm_select") return;

  const selected = interaction.values[0];
  const user = interaction.user;
  const userData = getUser(user.id);

  // BALANCE 0 CHECK
  if (userData.bank <= 0) {
    return await interaction.reply({
      content: "Your bank balance is **0 BIGPAY**. You cannot open a withdrawal ticket with zero balance.",
      ephemeral: true
    });
  }

  const methodNames = {
    upi: "UPI",
    redeem: "Redeem",
    recharge: "Recharge",
    crypto: "Crypto (LTC)"
  };

  const ticket = await interaction.guild.channels.create({
    name: `atm-${user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: user.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      }
    ]
  });

  const ticketEmbed = new EmbedBuilder()
    .setTitle("Withdrawal Ticket - Big Deal Bank")
    .setDescription(
      `Hello <@${user.id}>! Your ticket has been opened.\n\n` +
      `Please provide the following details so our staff can process your withdrawal:\n\n` +
      `**1.** How much BIGPAY do you want to withdraw?\n` +
      `**2.** What is your UPI ID? (e.g. name@upi)\n` +
      `**3.** Any other payment details if required\n\n` +
      `> Staff will respond as soon as possible. Please be patient.`
    )
    .addFields(
      { name: "Payment Method", value: methodNames[selected], inline: true },
      { name: "Your Bank Balance", value: `${userData.bank} BIGPAY`, inline: true }
    )
    .setColor(0x57f287)
    .setFooter({ text: "Big Deal Bank • Do not share sensitive info publicly" })
    .setTimestamp();

  ticket.send({ embeds: [ticketEmbed] });

  const logEmbed = new EmbedBuilder()
    .setTitle("ATM Log - New Ticket Opened")
    .setColor(0xffa500)
    .addFields(
      { name: "User", value: `<@${user.id}> (${user.username})`, inline: true },
      { name: "Method", value: methodNames[selected], inline: true },
      { name: "Bank Balance", value: `${userData.bank} BIGPAY`, inline: true },
      { name: "Holding", value: `${userData.holding} BIGPAY`, inline: true },
      { name: "Ticket", value: `${ticket}`, inline: true },
      { name: "Time", value: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), inline: false }
    )
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
  if (logChannel) logChannel.send({ embeds: [logEmbed] });

  await interaction.reply({
    content: `Your withdrawal ticket has been created: ${ticket}`,
    ephemeral: true
  });
});

// MESSAGE COMMANDS
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "ping") {
    return message.reply("Pong!");
  }

  if (command === "help") {
    return message.reply(
      "**Commands**\n\n" +
      "`!ping` - Check bot status\n" +
      "`!balance` - Check your balance\n" +
      "`!money add/remove @user amount` - Add or remove BIGPAY\n" +
      "`!withdraw amount` - Request withdrawal\n" +
      "`!leaderboard` - Top 10 richest users\n" +
      "`!qr <upi_id>` - Generate UPI QR code\n" +
      "`!panel` - Open ATM panel"
    );
  }

  if (command === "balance" || command === "bal") {
    const user = getUser(message.author.id);
    return message.reply(
      `**Your Balance**\n` +
      `Bank: ${user.bank} BIGPAY\n` +
      `Holding: ${user.holding} BIGPAY`
    );
  }

  if (command === "money") {
    const action = args[0];
    const targetUser = message.mentions.users.first();
    const amount = parseInt(args[2]);
    if (!targetUser) return message.reply("Please mention a user. Usage: `!money add @user amount`");
    if (isNaN(amount) || amount <= 0) return message.reply("Please enter a valid amount.");
    const target = getUser(targetUser.id);
    if (action === "add") {
      target.holding += amount;
      target.holdingData.push({ amount, time: Date.now() + (2 * 60 * 60 * 1000) });
      saveDB();
      return message.reply(`Added ${amount} BIGPAY to ${targetUser.username}'s holding. It will transfer to bank in 2 hours.`);
    }
    if (action === "remove") {
      if (target.holding < amount) return message.reply("This user does not have enough holding balance.");
      target.holding -= amount;
      saveDB();
      return message.reply(`Removed ${amount} BIGPAY from ${targetUser.username}'s holding.`);
    }
  }

  if (command === "withdraw") {
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply("Please enter a valid amount.");
    const user = getUser(message.author.id);
    if (user.bank < amount) return message.reply("You do not have enough bank balance.");
    user.bank -= amount;
    saveDB();
    return message.reply(`Withdrawal request created for ${amount} BIGPAY.`);
  }

  if (command === "leaderboard" || command === "lb") {
    const sorted = Object.entries(db.users)
      .map(([id, data]) => ({ id, total: (data.bank || 0) + (data.holding || 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    if (sorted.length === 0) return message.reply("No data available yet.");
    const medals = ["🥇", "🥈", "🥉"];
    let board = "**BIGPAY Leaderboard**\n\n";
    for (let i = 0; i < sorted.length; i++) {
      const medal = medals[i] || `#${i + 1}`;
      board += `${medal} <@${sorted[i].id}> - ${sorted[i].total} BIGPAY\n`;
    }
    return message.reply(board);
  }

  if (command === "qr") {
    const upiId = args[0];
    if (!upiId) return message.reply("Usage: `!qr yourname@upi`");
    const upiUrl = `upi://pay?pa=${upiId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUrl)}`;
    return message.reply({
      content: `UPI QR Code for \`${upiId}\``,
      files: [{ attachment: qrUrl, name: "qr.png" }]
    });
  }

  if (command === "panel") {
    const embed = new EmbedBuilder()
      .setTitle("ATM")
      .setDescription(
        "**BANK - Big Deal**\n\n" +
        "Hey, to convert your BIGPAY into any currency open this ticket\n\n" +
        "**Note:** Every task has its time to withdrawal\n\n" +
        "**Info Required:**\n" +
        "- Withdrawal amount\n" +
        "- Bank balance BIGPAY?\n" +
        "- Payment method (UPI / Paytm / wallets etc.)\n" +
        "- Payment details\n\n" +
        "**Rules:**\n" +
        "- Fake info = fine\n" +
        "- Low balance = fine\n" +
        "- Spam = fine\n" +
        "- We will take 5 BIGPAY as fine\n\n" +
        "Staff will respond as fast as they can. Keep patience.\n\n" +
        "**Available Payment Methods:**\n" +
        "- UPI\n" +
        "- Redeem\n" +
        "- Recharge\n" +
        "- Crypto (Only LTC)"
      )
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("atm_select")
        .setPlaceholder("Make a selection")
        .addOptions([
          { label: "UPI", value: "upi", emoji: "💳" },
          { label: "Redeem", value: "redeem", emoji: "🎁" },
          { label: "Recharge", value: "recharge", emoji: "📱" },
          { label: "Crypto (Only LTC)", value: "crypto", emoji: "🔐" }
        ])
    );

    return message.channel.send({ embeds: [embed], components: [row] });
  }
});

http.createServer((req, res) => res.end("Bot is running!")).listen(process.env.PORT || 3000);

client.login(process.env.TOKEN);
