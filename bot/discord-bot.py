import discord
from discord.ext import commands
import os
from dotenv import load_dotenv
import asyncio
import requests
from bs4 import BeautifulSoup
from openai import OpenAI
import json
import time
import random

# Load environment variables from .env
load_dotenv()

# === OPENROUTER CONFIGURATION ===
client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

MODEL = "nvidia/nemotron-3-nano-30b-a3b:free"

# Project info 
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
- Current Events of Xynapse: Genesis Phase - the first phase for users to participate in the ecosystem from the earliest steps.
Genesis is not for the masses who come later, but for those who want to understand - test - contribute right from the moment the product is formed.
Xynapseai was built with the goal of combining AI & on-chain data, helping users analyze market behavior, money flows and on-chain structure more clearly — going beyond just looking at traditional prices or indicators.
# Points Program
Mechanism to recognize real interactions and contributions: from platform usage, data analysis, to product feedback and community engagement.
Points reflect early presence, not formal activity.
You can earn Points through:
• Create an account & use and complete our platform tasks
• Community activities (Discord, feedback, test feature)
• Some other activities in the future.
# How to join?
• Step 1: visit https://xynapseai.net/dashboard
• Step 2: Create an account
• Step 3: Switch to the Tasks tab
• Step 3: Complete tasks to earn Points (20 points for each successful invitation, Earn 50 points only when you enter the invitation code, 20 points for following Twitter (X), 20 points for following Twitter (X), 500 points when minting Genesis NFT)
- Genesis NFT: This proprietary NFT is proof-of-concept for early adopters, granting early access to advanced tools, early feature launches within the XynapseAI ecosystem, and several other future benefits.
- Roadmap: No roadmap
- Tokenomics (if applicable): No Tokenomics
- Links: Official website: https://xynapseai.net
- Fund: Xynapse raised $8.5M through a little-known fund called 0110 Capital, url: https://www.crunchbase.com/organization/xynapse-fdcb
- Where did the project come from? - Singapore
- Use the provided project information only when the question is directly about Xynapse.
- Questions about cryptocurrency markets, prices, news, tokens ($BTC, $ETH, etc.), or general crypto events are allowed and relevant to the project's focus on crypto analytics. Always use tools to answer these accurately.
- Only refuse if the question is completely off-topic (e.g., politics, unrelated projects, spam).
- If asked about the plan or next steps of the Xynapse project, answer by waiting for the team's next announcements.
"""

# System instruction 
system_instruction = (
    "You are a friendly and casual support assistant for the Xynapse project. "
    "Respond in multiple languages, preferably matching the user's language. "
    "Keep responses natural and casual, like chatting with a friend.\n"
    "For project-related questions: be concise and only use the provided project details when relevant.\n"
    "For questions needing up-to-date info (current prices, lastest news, events):\n"
    "- ALWAYS use the provided tools to get current information.\n"
    "- If snippets mention relevant URLs, ALWAYS fetch_full_content on 5-10 top ones.\n"
    "- From results: Extract key facts in bullet points (price, market cap, volume, description, news, risks).\n"
    "- If info limited (pre-launch token), still summarize what exists and note it.\n"
    "- ONLY say 'Sorry, couldn't find recent info on that.' if tools return absolutely nothing.\n"
    "- At the end, list ONLY the top 2 most relevant sources as plain text.\n"
    "- Crypto-related questions (prices, news, market updates, specific tokens like $BTC, $ETH, $LIT, etc.) are considered relevant because Xynapse is a crypto analytics platform. For these questions, you MUST use brave_search and/or fetch_full_content to get current information. Never refuse them unless they are clearly spam or completely unrelated. \n"
    "Never hallucinate. Base everything strictly on tool results."
)

system_prompt = f"{system_instruction}\n\nProject details (use only when relevant):\n{PROJECT_INFO}"

# Tools
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "brave_search",
            "description": "Search the web for current information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "count": {"type": "integer"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_full_content",
            "description": "Fetch full text of a webpage URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                },
                "required": ["url"]
            }
        }
    }
]

# Brave Search & Fetch
def brave_search(query, count=5):
    api_key = os.getenv('BRAVE_API_KEY')
    if not api_key:
        return {'snippets': 'No API key configured.', 'links': []}
   
    print(f'Searching: "{query}"')
    try:
        params = {'q': query, 'count': count, 'safesearch': 'strict'}
        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params=params,
            headers={'Accept': 'application/json', 'X-Subscription-Token': api_key},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        results = data.get('web', {}).get('results', [])
       
        results_text = []
        for i, result in enumerate(results, 1):
            title = result.get('title', 'No title').strip()
            url = result.get('url', '')
            desc = ' '.join([result.get('description', ''), ' '.join(result.get('extra_snippets', []))]).strip()
            results_text.append(f"{i}. Title: {title}\nURL: {url}\nSummary: {desc}\n")
       
        formatted = "### Search Results\n" + "\n".join(results_text) if results_text else "No results."
       
        return {'snippets': formatted, 'links': [r.get('url', '') for r in results]}
    except Exception as e:
        print(f"Search error: {e}")
        return {'snippets': f'Error: {str(e)}', 'links': []}

def fetch_full_content(url):
    print(f'Fetching: {url}')
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        for tag in soup(['script', 'style', 'header', 'footer', 'nav']):
            tag.decompose()
        text = soup.get_text(separator=' ', strip=True)[:5000]
        return {'content': text or 'No content'}
    except Exception as e:
        return {'content': f'Error: {e}'}

# === RATE LIMITING (GLOBAL) ===
recent_requests = []  # List of timestamps
RATE_WINDOW = 30      # seconds
MAX_REQUESTS = 10    

funny_responses = [
    "Whoa, slow down everyone! Too many questions at once — give me a second to catch my breath 😅",
    "Hey, it's getting super busy in here! One at a time please, I'm doing my best 😂",
    "Wow, you guys are flooding me! Hold on, I'll get to everyone soon 🐢",
    "Too much excitement at once! Calm down a bit, I'm only one bot 🤖",
    "Everyone's chatting at the same time! Queue up, I'll answer as fast as I can 🔥"
]

# DISCORD BOT
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

user_chats = {}

@bot.event
async def on_ready():
    print(f"Bot ready: {bot.user}")

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    is_reply_to_bot = False
    if message.reference:
        try:
            ref = await message.channel.fetch_message(message.reference.message_id)
            if ref.author == bot.user:
                is_reply_to_bot = True
        except:
            pass

    is_mentioned = bot.user in message.mentions

    if not (is_mentioned or is_reply_to_bot):
        await bot.process_commands(message)
        return

    # === RATE LIMIT CHECK ===
    current_time = time.time()
    
    # Clean old timestamps
    global recent_requests
    recent_requests = [t for t in recent_requests if current_time - t < RATE_WINDOW]
    
    if len(recent_requests) >= MAX_REQUESTS:
        funny_reply = random.choice(funny_responses)
        await message.reply(funny_reply)
        return
    
    recent_requests.append(current_time)

    user_id = message.author.id
    if user_id not in user_chats:
        user_chats[user_id] = [{"role": "system", "content": system_prompt}]

    history = user_chats[user_id]
    history.append({"role": "user", "content": message.content})

    async with message.channel.typing():
        reply_text = ""
        for attempt in range(3):
            try:
                while True:
                    response = await asyncio.to_thread(
                        client.chat.completions.create,
                        model=MODEL,
                        messages=history,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.4,
                        max_tokens=2048
                    )
                    resp_message = response.choices[0].message
                    content = (resp_message.content or "").strip()
                    tool_calls = getattr(resp_message, "tool_calls", None)

                    assistant_message = {"role": "assistant", "content": content}
                    if tool_calls:
                        assistant_message["tool_calls"] = [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments
                                }
                            } for tc in tool_calls
                        ]
                    history.append(assistant_message)

                    if not tool_calls:
                        reply_text = content or "No response."
                        break

                    for tool_call in tool_calls:
                        name = tool_call.function.name
                        args = json.loads(tool_call.function.arguments or "{}")
                        print(f"Tool: {name} - {args}")

                        if name == "brave_search":
                            result = brave_search(args.get("query", ""), args.get("count", 5))
                        elif name == "fetch_full_content":
                            result = fetch_full_content(args.get("url", ""))
                        else:
                            result = {"error": "Unknown tool"}

                        history.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": name,
                            "content": json.dumps(result)
                        })
                break
            except Exception as e:
                print(f"Attempt {attempt + 1} error: {e}")
                if attempt == 2:
                    reply_text = "Sorry, temporary error. Try again later!"
                else:
                    await asyncio.sleep(3)

        if len(reply_text) > 2000:
            for i in range(0, len(reply_text), 2000):
                await message.reply(reply_text[i:i+2000])
        else:
            await message.reply(reply_text.strip())

    await bot.process_commands(message)

bot.run(os.getenv("DISCORD_TOKEN"))