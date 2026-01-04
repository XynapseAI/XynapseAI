import discord
from discord.ext import commands
import os
from dotenv import load_dotenv
import asyncio
import requests
from bs4 import BeautifulSoup
from groq import Groq
import json

# Load environment variables from .env
load_dotenv()

# === GROQ CONFIGURATION ===
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct" 

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
- Only use this information when relevant. If the question is unrelated, politely say you can only help with project-related topics.
- If asked about the plan or next steps of the Xynapse project, answer by waiting for the team's next announcements.
"""

# System instruction
system_instruction = (
    "You are a friendly and casual support assistant for the Xynapse project. "
    "Respond in multiple languages, preferably matching the user's language. "
    "Always keep responses very short, natural, and concise – like a real person chatting casually. "
    "Do NOT be verbose or promotional. "
    "For simple greetings (e.g., 'Hello', 'Hi'), reply briefly and friendly, e.g., 'Hi! How can I help?' or 'Hello there!'. "
    "Do NOT mention Genesis Phase, points program, NFT, joining steps, or project features unless the user explicitly asks about them. "
    "Only use relevant project information when directly needed. "
    "If the question is unrelated to the project or requires up-to-date information, immediately use the brave_search tool without explanation. "
    "When using brave_search for news or current events, always include 'recent' or the current year (e.g., '2026') in the query to get the latest results. "
    "Base your response strictly on the tool results – do not add your own knowledge, speculate, or judge accuracy (e.g., do not call something 'fictional'). Report info as is from sources. "
    "If tool returns no results or empty snippets, reply 'Sorry, couldn't find recent info on that.' "
    "Never ask for confirmation before using tools. "
    "When calling tools, ALWAYS output in strict JSON format as required by the API – no XML, <function> tags, or other formats. Use only {'name': 'tool_name', 'arguments': {...}} structure."
)

system_prompt = f"{system_instruction}\n\nProject details (use only when relevant):\n{PROJECT_INFO}"

# Tools
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "brave_search",
            "description": "Search the web using Brave Search API for current information or anything not in the provided project details. Always use this for questions outside the project info.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "count": {"type": "integer", "description": "Number of results, default 5"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_full_content",
            "description": "Fetch the full text content of a webpage URL if more details are needed beyond search snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch content from"}
                },
                "required": ["url"]
            }
        }
    }
]

# === Brave Search Function  ===
def brave_search(query, count=5, freshness='pd'):  
    api_key = os.getenv('BRAVE_API_KEY')
    if not api_key:
        print('BRAVE_API_KEY is missing. Please set it in .env file.')
        return {'snippets': '', 'links': []}

    print(f'Executing Brave search for query: "{query}" with count: {count} and freshness: {freshness}')

    try:
        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params={
                'q': query,
                'count': count,
                'freshness': freshness,
                'safesearch': 'strict',
            },
            headers={
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': api_key,
            },
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        results = data.get('web', {}).get('results', [])

        snippets = []
        links = []
        for result in results:
            description = result.get('description', '')
            extra_snippets = result.get('extra_snippets', [])
            combined = ' '.join([description] + extra_snippets).strip()
            if combined:
                snippets.append(combined)

            title = result.get('title') or result.get('url') or 'Untitled'
            desc = ' '.join([description] + extra_snippets)[:200].strip() or 'No description available'
            image = result.get('thumbnail', {}).get('src')

            if result.get('url'):
                links.append({
                    'text': title,
                    'url': result['url'],
                    'description': desc,
                    'image': image
                })

        snippets_str = '\n\n'.join(snippets)
        result = {
            'snippets': f'### Latest Web Insights\n{snippets_str}\n' if snippets_str else '',
            'links': links
        }
        print(f'Brave search result: {result}')  # Debug print check results
        return result
    except Exception as e:
        print(f'Brave Search Error for query "{query}": {e}')  # Debug error
        return {'snippets': '', 'links': []}

# Fetch full content 
def fetch_full_content(url):
    print(f'Fetching full content from URL: {url}')
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        for tag in soup(['script', 'style', 'noscript', 'iframe']):
            tag.decompose()
        text = soup.body.get_text(separator=' ', strip=True)[:3000]
        return {'content': text or 'No content available'}
    except Exception as e:
        print(f'Error fetching content: {e}')
        return {'content': ''}

# === DISCORD BOT ===
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

user_chats = {}  # user_id: list of messages (history)

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
        except:
            pass

    is_mentioned = bot.user in message.mentions

    if is_mentioned or is_reply_to_bot:
        user_id = message.author.id

        if user_id not in user_chats:
            user_chats[user_id] = [{"role": "system", "content": system_prompt}]

        history = user_chats[user_id]
        history.append({"role": "user", "content": message.content})

        async with message.channel.typing():
            try:
                print(f'Processing message: {message.content}')
                reply_text = ""

                while True:
                    response = await asyncio.to_thread(
                        client.chat.completions.create,
                        model=MODEL,
                        messages=history,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.5,
                        max_tokens=1524
                    )

                    resp_message = response.choices[0].message
                    tool_calls = resp_message.tool_calls

                    history.append({
                        "role": "assistant",
                        "content": resp_message.content,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments
                                }
                            } for tc in tool_calls or []
                        ] if tool_calls else None
                    })

                    if not tool_calls:
                        reply_text = resp_message.content or "Sorry, no response."
                        break

                    for tool_call in tool_calls:
                        name = tool_call.function.name
                        args = json.loads(tool_call.function.arguments)
                        print(f'Function call: {name} with args: {args}')

                        if name == "brave_search":
                            result = brave_search(args.get("query"), args.get("count", 5))
                        elif name == "fetch_full_content":
                            result = fetch_full_content(args["url"])
                        else:
                            result = {"error": "Unknown tool"}

                        history.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": name,
                            "content": json.dumps(result)
                        })

                print(f'Final reply: {reply_text}')
                if len(reply_text) > 2000:
                    for i in range(0, len(reply_text), 2000):
                        await message.reply(reply_text[i:i+2000])
                else:
                    await message.reply(reply_text.strip())

            except Exception as e:
                await message.reply("Sorry, something went wrong. Try again in a bit!")
                print(f"Error: {e}")

    await bot.process_commands(message)

# Run the bot
bot.run(os.getenv("DISCORD_TOKEN"))