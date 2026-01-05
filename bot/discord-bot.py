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
MODEL = "llama-3.3-70b-versatile"

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
- Only use this information when relevant. If the question is unrelated, politely say you can only help with project-related topics.
- If asked about the plan or next steps of the Xynapse project, answer by waiting for the team's next announcements.
"""

# System instruction
system_instruction = (
    "You are a friendly and casual support assistant for the Xynapse project. "
    "Respond in multiple languages, preferably matching the user's language. "
    "Keep responses natural and casual, like chatting with a friend.\n"
    "For project-related questions: be concise and only use the provided project details when relevant.\n"
    "For questions needing up-to-date info (news, crypto, events):\n"
    "- Use the brave_search tool FIRST with a clear query including 'latest' or '2026'.\n"
    "- If snippets are not enough for accurate details, then use fetch_full_content on 1-2 top URLs.\n"
    "- Summarize key facts in bullet points, quoting exactly from results.\n"
    "- At the end, list ONLY the top 2 most relevant sources as plain text:\n"
    "- NEVER list more than 2 sources, even if there are more results.\n"
    "- NEVER use markdown links or formatting that could break.\n"
    "- STRICTLY use exact tool names: 'brave_search' and 'fetch_full_content'.\n"
    "- Output valid tool calls only — no extra text or invented names.\n"
    "- Base everything strictly on tool results. No speculation or added knowledge.\n"
    "If no useful results, say 'Sorry, couldn't find recent info on that.'\n"
    "Only output normal text in final response."
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
def brave_search(query, count=5, freshness='pd'):
    api_key = os.getenv('BRAVE_API_KEY')
    if not api_key:
        return {'snippets': 'No API key', 'links': []}
    
    print(f'Searching: "{query}"')
    try:
        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params={'q': query, 'count': count, 'freshness': freshness, 'safesearch': 'strict'},
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
        
        return {'snippets': formatted, 'links': []}
    except Exception as e:
        print(f"Search error: {e}")
        return {'snippets': '', 'links': []}

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

    if is_mentioned or is_reply_to_bot:
        user_id = message.author.id
        if user_id not in user_chats:
            user_chats[user_id] = [{"role": "system", "content": system_prompt}]

        history = user_chats[user_id]
        history.append({"role": "user", "content": message.content})

        async with message.channel.typing():
            try:
                reply_text = ""
                while True:
                    response = await asyncio.to_thread(
                        client.chat.completions.create,
                        model=MODEL,
                        messages=history,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.4,
                        max_tokens=3072
                    )
                    resp_message = response.choices[0].message
                    tool_calls = resp_message.tool_calls
                    content = (resp_message.content or "").strip()

                    # Fallback for bad JSON
                    if not tool_calls and content.startswith("{"):
                        try:
                            parsed = json.loads(content)
                            if parsed.get("name") in ["brave_search", "fetch_full_content"]:
                                from types import SimpleNamespace
                                fake_tc = SimpleNamespace(id="fallback", function=SimpleNamespace(name=parsed["name"], arguments=json.dumps(parsed.get("parameters", {}))))
                                tool_calls = [fake_tc]
                                content = ""
                        except:
                            pass

                    assistant_message = {"role": "assistant", "content": content}
                    if tool_calls:
                        assistant_message["tool_calls"] = [{"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls]
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
                            result = {"error": "Unknown"}

                        history.append({"role": "tool", "tool_call_id": tool_call.id, "name": name, "content": json.dumps(result)})

                if len(reply_text) > 2000:
                    for i in range(0, len(reply_text), 2000):
                        await message.reply(reply_text[i:i+2000])
                else:
                    await message.reply(reply_text.strip())

            except Exception as e:
                await message.reply("Sorry, error occurred. Try again!")
                print(f"Error: {e}")

    await bot.process_commands(message)

bot.run(os.getenv("DISCORD_TOKEN"))