/**
 * Bridle Dashboard — Real-time Agent Monitor
 * Connects via WebSocket to display live agent activity.
 */

// ─── State ───
const state = {
    agents: new Map(),
    ws: null,
    feedItems: [],
    maxFeedItems: 100,
};

// ─── DOM References ───
const $agentsGrid = document.getElementById('agents-grid');
const $emptyState = document.getElementById('empty-state');
const $activityFeed = document.getElementById('activity-feed');
const $spawnBtn = document.getElementById('spawn-btn');
const $agentName = document.getElementById('agent-name');
const $riskProfile = document.getElementById('risk-profile');
const $clearFeedBtn = document.getElementById('clear-feed-btn');
const $connectionStatus = document.getElementById('connection-status');
const $headerAgentCount = document.querySelector('#header-agent-count .stat-value');
const $headerTotalTrades = document.querySelector('#header-total-trades .stat-value');

// ─── WebSocket Connection ───
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
        updateConnectionStatus('connected');
        addFeedItem('system', 'Connected to Bridle server');
    };

    state.ws.onclose = () => {
        updateConnectionStatus('disconnected');
        addFeedItem('error', 'Disconnected from server. Reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = () => {
        updateConnectionStatus('disconnected');
    };

    state.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWSMessage(data);
        } catch (e) {
            console.error('Failed to parse WS message:', e);
        }
    };
}

function updateConnectionStatus(status) {
    const dot = $connectionStatus.querySelector('.status-dot');
    const text = $connectionStatus.querySelector('.status-text');

    dot.className = 'status-dot ' + status;
    text.textContent = status === 'connected' ? 'Connected' :
        status === 'disconnected' ? 'Disconnected' : 'Connecting...';
}

// ─── Message Handler ───
function handleWSMessage(msg) {
    // Handle initial snapshot
    if (msg.type === 'snapshot') {
        for (const agent of msg.data.agents) {
            state.agents.set(agent.id, agent);
            renderAgentCard(agent);
        }
        updateHeaderStats();
        return;
    }

    // Handle agent events
    const { type, agentId, data, timestamp } = msg;

    switch (type) {
        case 'agent:spawned':
            handleAgentSpawned(agentId, data, timestamp);
            break;
        case 'agent:decision':
            handleAgentDecision(agentId, data, timestamp);
            break;
        case 'agent:trade':
            handleAgentTrade(agentId, data, timestamp);
            break;
        case 'agent:balance':
            handleAgentBalance(agentId, data);
            break;
        case 'agent:stopped':
            handleAgentStopped(agentId, data, timestamp);
            break;
        case 'agent:error':
            handleAgentError(agentId, data, timestamp);
            break;
        case 'agent:cycle':
            handleAgentCycle(agentId, data);
            break;
    }

    updateHeaderStats();
}

function handleAgentSpawned(agentId, data, timestamp) {
    const agent = {
        id: agentId,
        name: data.name,
        publicKey: data.publicKey,
        balanceSOL: data.balance || 0,
        status: 'running',
        riskProfile: data.riskProfile,
        lastDecision: null,
        tradeHistory: [],
        cycleCount: 0,
        totalTradesExecuted: 0,
    };
    state.agents.set(agentId, agent);
    renderAgentCard(agent);
    addFeedItem('system', `<strong>${data.name}</strong> spawned with ${data.riskProfile} risk profile`, timestamp);
    showToast(`Agent "${data.name}" spawned!`, 'success');
}

function handleAgentDecision(agentId, data, timestamp) {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    agent.lastDecision = data.decision;
    agent.status = 'deciding';
    agent.cycleCount = data.cycle;
    updateAgentCard(agent);

    const decision = data.decision;
    const actionIcon = decision.action === 'BUY' ? '<i class="bi bi-arrow-up-circle-fill" style="color:var(--color-buy)"></i>' : decision.action === 'SELL' ? '<i class="bi bi-arrow-down-circle-fill" style="color:var(--color-sell)"></i>' : '<i class="bi bi-pause-circle" style="color:var(--color-hold)"></i>';
    addFeedItem('decision',
        `${actionIcon} <strong>${agent.name}</strong> → ${decision.action}${decision.action !== 'HOLD' ? ` ${decision.amountSOL} SOL → ${decision.outputToken}` : ''} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
        timestamp
    );
}

function handleAgentTrade(agentId, data, timestamp) {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    agent.tradeHistory.push(data.result);
    agent.totalTradesExecuted = agent.tradeHistory.filter(t => t.success).length;
    agent.balanceSOL = data.newBalance;
    agent.status = 'running';
    updateAgentCard(agent);

    // Flash the card
    const card = document.getElementById(`agent-${agentId}`);
    if (card) {
        card.classList.add('flash-trade');
        setTimeout(() => card.classList.remove('flash-trade'), 1500);
    }

    if (data.result.success) {
        addFeedItem('trade',
            `<i class="bi bi-check-circle-fill" style="color:var(--color-success)"></i> <strong>${agent.name}</strong> traded ${data.result.inputAmount} ${data.result.inputToken} → ${data.result.outputToken} | <a href="https://explorer.solana.com/tx/${data.result.signature}?cluster=devnet" target="_blank">View Tx</a>`,
            timestamp
        );
    } else {
        addFeedItem('error',
            `<i class="bi bi-x-circle-fill" style="color:var(--color-error)"></i> <strong>${agent.name}</strong> trade failed: ${data.result.error?.substring(0, 80)}`,
            timestamp
        );
    }
}

function handleAgentBalance(agentId, data) {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    agent.balanceSOL = data.balance;
    updateAgentCard(agent);
}

function handleAgentStopped(agentId, data, timestamp) {
    const agent = state.agents.get(agentId);
    if (agent) {
        agent.status = 'stopped';
        addFeedItem('system', `<strong>${agent.name}</strong> stopped`, timestamp);
    }
    state.agents.delete(agentId);
    removeAgentCard(agentId);
    showToast(`Agent stopped`, 'info');
}

function handleAgentError(agentId, data, timestamp) {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    agent.status = 'error';
    updateAgentCard(agent);
    addFeedItem('error', `<i class="bi bi-exclamation-triangle-fill" style="color:var(--accent)"></i> <strong>${agent.name}</strong> error: ${data.error?.substring(0, 100)}`, timestamp);
}

function handleAgentCycle(agentId, data) {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    agent.cycleCount = data.cycle;
    agent.status = data.status;
    agent.balanceSOL = data.balance;
    updateAgentCard(agent);
}

// ─── Agent Card Rendering ───
function renderAgentCard(agent) {
    // Remove empty state
    if ($emptyState) $emptyState.style.display = 'none';

    // Remove existing card if present
    const existing = document.getElementById(`agent-${agent.id}`);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = `agent-${agent.id}`;
    card.innerHTML = buildCardHTML(agent);
    $agentsGrid.appendChild(card);

    // Bind card buttons
    bindCardActions(agent.id, card);
}

function updateAgentCard(agent) {
    const card = document.getElementById(`agent-${agent.id}`);
    if (!card) return renderAgentCard(agent);

    // Update specific elements without re-rendering entire card
    const statusEl = card.querySelector('.card-status');
    if (statusEl) {
        statusEl.className = `card-status ${agent.status}`;
        statusEl.innerHTML = `<span class="card-status-dot"></span>${agent.status}`;
    }

    const balanceEl = card.querySelector('.balance-value');
    if (balanceEl) balanceEl.textContent = formatSOL(agent.balanceSOL);

    const cycleEl = card.querySelector('.cycle-value');
    if (cycleEl) cycleEl.textContent = agent.cycleCount;

    const tradesEl = card.querySelector('.trades-value');
    if (tradesEl) tradesEl.textContent = agent.totalTradesExecuted;

    // Update decision box
    const decisionBox = card.querySelector('.card-decision');
    if (decisionBox && agent.lastDecision) {
        decisionBox.innerHTML = buildDecisionHTML(agent.lastDecision);
    }
}

function removeAgentCard(agentId) {
    const card = document.getElementById(`agent-${agentId}`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => card.remove(), 300);
    }

    // Show empty state if no agents
    if (state.agents.size === 0 && $emptyState) {
        $emptyState.style.display = 'flex';
    }
}

function buildCardHTML(agent) {
    const initials = agent.name.substring(0, 2).toUpperCase();
    const shortPubkey = agent.publicKey
        ? `${agent.publicKey.substring(0, 4)}...${agent.publicKey.substring(agent.publicKey.length - 4)}`
        : '...';

    return `
    <div class="card-header">
      <div class="card-agent-info">
        <div class="agent-avatar">${initials}</div>
        <div>
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-pubkey" title="${agent.publicKey}" onclick="copyToClipboard('${agent.publicKey}')">${shortPubkey}</div>
        </div>
      </div>
      <div class="card-status ${agent.status}">
        <span class="card-status-dot"></span>
        ${agent.status}
      </div>
    </div>
    <div class="card-body">
      <div class="card-stats">
        <div class="card-stat">
          <span class="card-stat-label">Balance</span>
          <span class="card-stat-value balance balance-value">${formatSOL(agent.balanceSOL)}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Risk Profile</span>
          <span class="card-stat-value">${agent.riskProfile || 'moderate'}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Cycles</span>
          <span class="card-stat-value cycle-value">${agent.cycleCount || 0}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Trades</span>
          <span class="card-stat-value trades-value">${agent.totalTradesExecuted || 0}</span>
        </div>
      </div>
      <div class="card-decision">
        ${agent.lastDecision ? buildDecisionHTML(agent.lastDecision) : '<div class="decision-label">Awaiting first decision...</div>'}
      </div>
    </div>
    <div class="card-footer">
      <button class="btn-ghost btn-sm btn-success airdrop-btn"><i class="bi bi-coin"></i> Airdrop</button>
      <button class="btn-ghost btn-sm btn-danger stop-btn"><i class="bi bi-stop-circle"></i> Stop</button>
    </div>
  `;
}

function buildDecisionHTML(decision) {
    return `
    <div class="decision-header">
      <span class="decision-label">Last Decision</span>
      <span class="decision-action ${decision.action}">${decision.action}</span>
    </div>
    <div class="decision-reasoning">${escapeHtml(decision.reasoning)}</div>
  `;
}

function bindCardActions(agentId, card) {
    const airdropBtn = card.querySelector('.airdrop-btn');
    const stopBtn = card.querySelector('.stop-btn');

    if (airdropBtn) {
        airdropBtn.addEventListener('click', () => requestAirdrop(agentId));
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => stopAgent(agentId));
    }
}

// ─── API Actions ───
async function spawnAgent() {
    const name = $agentName.value.trim() || undefined;
    const riskProfile = $riskProfile.value;

    $spawnBtn.disabled = true;
    $spawnBtn.textContent = 'Spawning...';

    try {
        const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, riskProfile }),
        });

        const data = await res.json();
        if (!data.success) {
            showToast(`Failed to spawn: ${data.error}`, 'error');
        }

        $agentName.value = '';
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        $spawnBtn.disabled = false;
        $spawnBtn.innerHTML = '<i class="bi bi-plus-lg"></i> Spawn Agent';
    }
}

async function stopAgent(agentId) {
    try {
        const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) {
            showToast(`Failed to stop: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function requestAirdrop(agentId) {
    try {
        showToast('Requesting airdrop...', 'info');
        const res = await fetch(`/api/agents/${agentId}/airdrop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 1 }),
        });

        const data = await res.json();
        if (data.success) {
            showToast(`Airdrop received! New balance: ${formatSOL(data.newBalance)}`, 'success');
            const agent = state.agents.get(agentId);
            if (agent) {
                agent.balanceSOL = data.newBalance;
                updateAgentCard(agent);
            }
        } else {
            showToast(`Airdrop failed: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

// ─── Activity Feed ───
function addFeedItem(type, message, timestamp) {
    const feedEmpty = $activityFeed.querySelector('.feed-empty');
    if (feedEmpty) feedEmpty.remove();

    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
    <span class="feed-dot ${type}"></span>
    <div class="feed-content">
      <div class="feed-message">${message}</div>
      <div class="feed-time">${formatTime(timestamp)}</div>
    </div>
  `;

    $activityFeed.insertBefore(item, $activityFeed.firstChild);

    // Limit feed items
    state.feedItems.push(item);
    if (state.feedItems.length > state.maxFeedItems) {
        const old = state.feedItems.shift();
        old?.remove();
    }
}

function clearFeed() {
    $activityFeed.innerHTML = '<div class="feed-empty">Feed cleared</div>';
    state.feedItems = [];
}

// ─── Header Stats ───
function updateHeaderStats() {
    $headerAgentCount.textContent = state.agents.size;
    let totalTrades = 0;
    for (const agent of state.agents.values()) {
        totalTrades += agent.totalTradesExecuted || 0;
    }
    $headerTotalTrades.textContent = totalTrades;
}

// ─── Utilities ───
function formatSOL(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return '0.0000';
    return amount.toFixed(4) + ' SOL';
}

function formatTime(timestamp) {
    if (!timestamp) return new Date().toLocaleTimeString();
    return new Date(timestamp).toLocaleTimeString();
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Address copied!', 'info');
    });
}

// ─── Toast Notifications ───
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Make copyToClipboard global for inline onclick
window.copyToClipboard = copyToClipboard;

// ─── Event Listeners ───
$spawnBtn.addEventListener('click', spawnAgent);
$clearFeedBtn.addEventListener('click', clearFeed);

$agentName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') spawnAgent();
});

// ─── Initialize ───
connectWebSocket();
