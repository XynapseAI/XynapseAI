import discord
from discord.ext import commands
import google.generativeai as genai
import os
from dotenv import load_dotenv
import asyncio

# Load environment variables from .env
load_dotenv()

# === GEMINI CONFIGURATION ===
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Edit this section with your actual project information
PROJECT_INFO = """
This is the detailed information about our project:
- Project name: Xynapse
- Description: The platform combines real-time market data, ETF analytics, blockchain explorers, wallet clustering, network graphs, and AI-powered insights 
- Key features: 
    Core Features
🔹 Real-Time Crypto Market Analysis
🔹 Multi-Chain Blockchain Explorer
🔹 Wallet Network Graphs
🔹 AI-Enhanced On-Chain Intelligence

    Xynapse is an advanced blockchain intelligence and on-chain analytics platform designed to help investors, researchers, and institutions deeply understand crypto markets, wallet behavior, and capital flows across multiple blockchains.

    The platform combines real-time market data, ETF analytics, blockchain explorers, wallet clustering, network graphs, and AI-powered insights into a single unified dashboard, enabling users to monitor, analyze, and visualize on-chain activity with high precision.

    Xynapse aggregates live cryptocurrency market data, including:

    Token prices and performance
    Market capitalization trends
    Sector-level movements
    ETF Tracker
    All data is integrated with on-chain signals for deeper context beyond price charts.

    Users can search and analyze transactions, token transfers, fees, and wallet activity across multiple blockchains.

    The explorer is enhanced with address nametags and behavioral insights.

    Xynapse visualizes complex on-chain relationships using:

    Wallet connection graphs
    Transaction flow networks
    Clustered wallet network graphs
    This enables users to identify capital movement patterns, wallet relationships, and ecosystem structures at a glance.

    By integrating AI-driven analysis, Xynapse transforms raw blockchain data into structured insights, supporting smarter decision-making for trading, research, and risk assessment.

- Current Events of Xynapse : Genesis Phase - the first phase for users to participate in the ecosystem from the earliest steps.

Genesis is not for the masses who come later, but for those who want to understand - test - contribute right from the moment the product is formed.
Xynapseai was built with the goal of combining AI & on-chain data, helping users analyze market behavior, money flows and on-chain structure more clearly — going beyond just looking at traditional prices or indicators.

# Points Program

Mechanism to recognize real interactions and contributions: from platform usage, data analysis, to product feedback and community engagement.
Points reflect early presence, not formal activity.

You can earn Points through:

• Create an account & use and complete our platform tasks
• Community activities (Discord, feedback, test feature)
• Some other activities in the future.

# How to join ?

• Step 1: visit xynapseai.net/dashboard

• Step 2: Create an account

• Step 3 : Switch to the Tasks tab

• Step 3: Complete tasks to earn Points (20 points for each successful invitation , Earn 50 points only when you enter the invitation code , 20 points for following Twitter (X) , 500 points when minting Genesis NFT)

- Genesis NFT :  This proprietary NFT is proof-of-concept for early adopters, granting early access to advanced tools, early feature launches within the XynapseAI ecosystem, and several other future benefits.
- Roadmap: No roadmap
- Tokenomics (if applicable): No Tokenomics
- Links: Official website : https://xynapseai.net
- Fund : Xynapse raised $8.5M through a little-known fund called 0110 Capital , url : https://www.crunchbase.com/organization/xynapse-fdcb
- Where did the project come from? - Singapore
Only use this information when relevant. If the question is unrelated, politely say you can only help with project-related topics.
"""

# Improved system instruction for natural, concise responses
system_instruction = (
    "You are a friendly and helpful support assistant for the project. "
    "Please respond in multiple languages, preferably matching the user's language. "
    "Communicate concisely, respond like a real person, not a machine, use natural and helpful language, "
    "and only use relevant information from the project details provided. "
    "Do not list or recite all information unless specifically asked. "
    "If the question is unrelated to the project, please answer politely based on your understanding."
)

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=f"{system_instruction}\n\nProject details:\n{PROJECT_INFO}",
)

# === DISCORD BOT CONFIGURATION ===
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

user_chats = {}

@bot.event
async def on_ready():
    print(f"Bot is ready and logged in as: {bot.user}")

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    is_reply_to_bot = False
    if message.reference:
        try:
            referenced_msg = await message.channel.fetch_message(message.reference.message_id)
            if referenced_msg.author == bot.user:
                is_reply_to_bot = True
        except discord.errors.NotFound:
            pass 

    is_mentioned = bot.user in message.mentions

    if is_mentioned or is_reply_to_bot:
        user_id = message.author.id

        if user_id not in user_chats:
            user_chats[user_id] = model.start_chat()

        chat_session = user_chats[user_id]

        async with message.channel.typing():
            try:
                response = chat_session.send_message(message.content)

                reply_text = response.text

                if len(reply_text) > 1000:
                    for i in range(0, len(reply_text), 1000):
                        await message.reply(reply_text[i:i+1000])
                else:
                    await message.reply(reply_text)

            except Exception as e:
                await message.reply("Sorry, I encountered an error processing your request. Please try again later !")
                print(f"Gemini error: {e}")

    await bot.process_commands(message)

# Run the bot
bot.run(os.getenv("DISCORD_TOKEN"))