// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ----------------- Config -----------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2";

let NETWORK = "bsc";
let POOL_ADDRESS = "0xaead6bd31dd66eb3a6216aaf271d0e661585b0b1";
let TRACKED_TOKEN = "base"; 
let TOKEN_SYMBOL = "ASTER"; 

let lastPrice = null;
let priceTrend = "⬈"; // default
let refreshInterval = 30000; // default 30s
let priceInterval = null;

// Role names for auto assignment
const GREEN_ROLE = "ticker-green";
const RED_ROLE = "ticker-red";



// ----------------- Discord Client -----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ----------------- Fetch Price -----------------
async function updatePrice() {
  try {
    const response = await axios.get(
      `${GECKOTERMINAL_API}/networks/${NETWORK}/pools/${POOL_ADDRESS}`
    );

    const pool = response.data.data.attributes;
    const priceUSD =
      TRACKED_TOKEN === "base"
        ? parseFloat(pool.base_token_price_usd)
        : parseFloat(pool.quote_token_price_usd);

    // Convert USD → PHP
    const rateResp = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const usdToPhp = rateResp.data.rates.PHP;
    const pricePHP = priceUSD * usdToPhp;

    // Determine trend (⬈ / ⬊ only)
    if (lastPrice !== null) {
      if (pricePHP > lastPrice) priceTrend = "⬈";
      else if (pricePHP < lastPrice) priceTrend = "⬊";
    }

    console.log(
      `Fetched ${TOKEN_SYMBOL}: $${priceUSD.toFixed(4)} → ₱${pricePHP.toFixed(4)} ${priceTrend}  | ${new Date().toLocaleTimeString("en-PH", { hour12: false })} `
    );

    // Update nickname + roles
    for (const guild of client.guilds.cache.values()) {
      const me = guild.members.me;
      if (!me) continue;

      const nickname = `${TOKEN_SYMBOL} ${priceTrend} ₱${pricePHP.toFixed(4)}`;
      if (me.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
        await me.setNickname(nickname).catch(() => {});
      }

      try {
        const greenRole = guild.roles.cache.find(r => r.name === GREEN_ROLE);
        const redRole = guild.roles.cache.find(r => r.name === RED_ROLE);

        if (priceTrend === "⬈" && greenRole) {
          await me.roles.add(greenRole).catch(() => {});
          if (redRole) await me.roles.remove(redRole).catch(() => {});
        } else if (priceTrend === "⬊" && redRole) {
          await me.roles.add(redRole).catch(() => {});
          if (greenRole) await me.roles.remove(greenRole).catch(() => {});
        }
      } catch (err) {
        console.error(`Role update error: ${err.message}`);
      }
    }

    lastPrice = pricePHP;
  } catch (error) {
    console.error(`Error fetching pool price: ${error.message}`);
  }
}

// ----------------- Interval Control -----------------
function startPriceUpdates() {
  if (priceInterval) clearInterval(priceInterval);
  priceInterval = setInterval(updatePrice, refreshInterval);
  console.log(`🔄 Price updates running every ${refreshInterval / 1000}s`);
}

// ----------------- Discord Bot Events -----------------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  updatePrice();
  startPriceUpdates();
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  switch (command) {
    case "!price":
      if (lastPrice) {
        await message.reply(`${TOKEN_SYMBOL} Price: ₱${lastPrice.toFixed(4)} ${priceTrend}`);
      } else {
        await message.reply("Price not available yet, please wait...");
      }
      break;

    case "!trend":
      await message.reply(`Current trend: ${priceTrend}`);
      break;

    case "!setpool":
      if (args.length < 5) {
        return message.reply("Usage: !setpool <network> <pool_address> <base|quote> <symbol>");
      }
      NETWORK = args[1];
      POOL_ADDRESS = args[2];
      TRACKED_TOKEN = args[3]?.toLowerCase() === "quote" ? "quote" : "base";
      TOKEN_SYMBOL = args[4]?.toUpperCase() || "TOKEN";

      await updatePrice();
      await message.reply(`Now tracking ${TOKEN_SYMBOL} (${TRACKED_TOKEN.toUpperCase()})`);
      break;

    case "!setinterval":
      if (args.length < 2 || isNaN(args[1])) {
        return message.reply("Usage: !setinterval <seconds>");
      }
      const seconds = parseInt(args[1]);
      if (seconds < 5) return message.reply("Minimum refresh interval is 5 seconds.");

      refreshInterval = seconds * 1000;
      startPriceUpdates();
      await message.reply(`Refresh interval set to ${seconds} seconds.`);
      break;

    case "!help":
      await message.reply(
        "**Commands:**\n" +
        "`!price` → shows current price\n" +
        "`!trend` → shows current trend (⬈ / ⬊)\n" +
        "`!setpool <network> <pool_address> <base|quote> <symbol>` → change pool/token\n" +
        "`!setinterval <seconds>` → change refresh interval\n" +
        "`!help` → show this help menu"
      );
      break;
  }
});

// ----------------- Express API -----------------
app.get('/', (req, res) => {
  res.json({
    message: "Crypto Bot is running",
    token: TOKEN_SYMBOL,
    price_php: lastPrice ? lastPrice.toFixed(4) : null,
    trend: priceTrend,
    interval_seconds: refreshInterval / 1000,
  });
});

// ----------------- Start Server -----------------
app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});

// ----------------- Login Bot -----------------
client.login(DISCORD_TOKEN);
