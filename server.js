const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the index.html file for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Game State Management ---
let players = []; // Lobby players
let gameState = null; // Active game state
const reconnectTimers = {};
const DISCONNECT_GRACE_PERIOD = 60000; // 60 seconds
let gameOverCleanupTimer = null; // Timer to clean up after game over

// --- Card Definitions ---
const COLORS = ['Red', 'Green', 'Blue', 'Yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw Two'];
const WILD_VALUES = ['Wild', 'Wild Draw Four', 'Wild Swap', 'Wild Pick Until'];
const CUSTOM_CARDS = ['Wild Swap', 'Wild Pick Until'];
const CARDS_TO_DEAL = 7; // Default
const CARD_POINTS = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'Skip': 20, 'Reverse': 20,
    'Draw Two': 25,
    'Wild': 50, 'Wild Draw Four': 50, 'Wild Pick Until': 50,
    'Wild Swap': 100
};

// --- Deck Creation Logic ---
function createDeck() {
    let deck = [];
    let idCounter = 0;

    // Standard number cards
    for (const color of COLORS) {
        // One '0' card
        deck.push({ id: idCounter++, color: color, value: '0' });
        // Two of each number 1-9
        for (let i = 1; i <= 9; i++) {
            deck.push({ id: idCounter++, color: color, value: i.toString() });
            deck.push({ id: idCounter++, color: color, value: i.toString() });
        }
        // Two of each action card
        for (const value of ['Skip', 'Reverse', 'Draw Two']) {
            deck.push({ id: idCounter++, color: color, value: value });
            deck.push({ id: idCounter++, color: color, value: value });
        }
    }

    // Wild cards
    for (let i = 0; i < 4; i++) {
        deck.push({ id: idCounter++, color: 'Black', value: 'Wild' });
        deck.push({ id: idCounter++, color: 'Black', value: 'Wild Draw Four' });
    }

    // Custom Wild cards
    for (const value of CUSTOM_CARDS) {
         for (let i = 0; i < 2; i++) { // Two of each custom card
            deck.push({ id: idCounter++, color: 'Black', value: value });
         }
    }
    
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function initializeDeck() {
    let deck = createDeck();
    gameState.drawPile = shuffleDeck(deck);
    gameState.discardPile = [];
}

// --- Game Helper Functions ---
function addLog(message) {
    if (!gameState) return;
    gameState.logHistory.unshift(message);
    if (gameState.logHistory.length > 50) {
        gameState.logHistory.pop();
    }
}

function getPlayer(playerId) {
    if (!gameState) return null;
    return gameState.players.find(p => p.playerId === playerId);
}

function getActivePlayers() {
    if (!gameState) return [];
    return gameState.players.filter(p => p.status === 'Active');
}

function getNextPlayerIndex(startIndex) {
    const activePlayers = getActivePlayers();
    if (activePlayers.length === 0) return -1;

    const direction = gameState.turnDirection;
    let currentIndex = gameState.players.findIndex(p => p.playerId === activePlayers[startIndex].playerId);
    
    let nextIndex;
    do {
        nextIndex = (currentIndex + direction + gameState.players.length) % gameState.players.length;
        currentIndex = nextIndex;
    } while (gameState.players[nextIndex].status !== 'Active');
    
    return nextIndex;
}

function advanceTurn(skipCount = 1) {
    if (!gameState) return;

    const activePlayers = getActivePlayers();
    if (activePlayers.length < 2) {
        // Not enough players to advance turn
        return;
    }

    const currentPlayerIndexInActive = activePlayers.findIndex(p => p.playerId === gameState.currentPlayerId);
    if (currentPlayerIndexInActive === -1) {
        // Current player is not active, find the first active player
        const firstActivePlayer = gameState.players.find(p => p.status === 'Active');
        if (firstActivePlayer) {
            gameState.currentPlayerId = firstActivePlayer.playerId;
        }
        return;
    }
    
    const nextPlayerIndexInActive = (currentPlayerIndexInActive + skipCount) % activePlayers.length;
    const nextPlayer = activePlayers[nextPlayerIndexInActive];
    
    gameState.currentPlayerId = nextPlayer.playerId;
}


function startFirstCard() {
    let card = gameState.drawPile.pop();
    
    // Ensure the first card is not a Wild Draw Four or other complex Wild
    while (card.color === 'Black' && (card.value === 'Wild Draw Four' || CUSTOM_CARDS.includes(card.value))) {
        gameState.drawPile.push(card);
        gameState.drawPile = shuffleDeck(gameState.drawPile);
        card = gameState.drawPile.pop();
    }

    gameState.discardPile.push(card);
    addLog(`First card is a ${card.color} ${card.value}.`);

    if (card.color === 'Black') {
        // Simple 'Wild' card. The dealer (first player) gets to choose.
        gameState.pendingAction = {
            type: 'choose-color',
            playerSocketId: gameState.players[0].socketId,
            card: card
        };
        io.to(gameState.players[0].socketId).emit('chooseColor', card);
    } else {
        // Regular card or simple action card
        gameState.currentColor = card.color;
        handleCardEffects(card, gameState.players[0].playerId);
    }
}

function drawCards(player, numCards) {
    if (!player) return;
    let drawnCards = [];
    for (let i = 0; i < numCards; i++) {
        if (gameState.drawPile.length === 0) {
            reshuffleDiscardPile();
            if (gameState.drawPile.length === 0) {
                addLog('No more cards to draw!');
                break;
            }
        }
        const card = gameState.drawPile.pop();
        player.hand.push(card);
        drawnCards.push(card);
    }
    
    if (drawnCards.length > 0) {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
            playerSocket.emit('cardsDrawn', drawnCards);
        }
    }
}

function reshuffleDiscardPile() {
    addLog('Reshuffling discard pile into draw pile.');
    const topCard = gameState.discardPile.pop();
    let cardsToShuffle = gameState.discardPile;
    
    // Filter out cards from pending actions (e.g., Wild Pick Until discards)
    cardsToShuffle = cardsToShuffle.filter(card => !card.isDiscardedWild);
    
    gameState.drawPile = shuffleDeck(cardsToShuffle);
    gameState.discardPile = [topCard];
}

function handleCardEffects(card, playedByPlayerId) {
    const player = getPlayer(playedByPlayerId);
    if (!player) return;

    switch(card.value) {
        case 'Skip':
            addLog(`${player.name} skipped the next player.`);
            advanceTurn(2); // Skip one player
            break;
        case 'Reverse':
            gameState.turnDirection *= -1;
            addLog(`${player.name} reversed the turn order.`);
            advanceTurn();
            break;
        case 'Draw Two':
            advanceTurn();
            const nextPlayerDT = getPlayer(gameState.currentPlayerId);
            if (nextPlayerDT) {
                addLog(`${player.name} made ${nextPlayerDT.name} draw 2 cards.`);
                drawCards(nextPlayerDT, 2);
            }
            advanceTurn(); // Also skip the player who drew
            break;
        case 'Wild':
            // Color choice is handled by client, this just advances turn
            advanceTurn();
            break;
        case 'Wild Draw Four':
            advanceTurn();
            const nextPlayerWDF = getPlayer(gameState.currentPlayerId);
            if (nextPlayerWDF) {
                addLog(`${player.name} made ${nextPlayerWDF.name} draw 4 cards.`);
                drawCards(nextPlayerWDF, 4);
            }
            advanceTurn(); // Also skip the player who drew
            break;
        
        // Custom card effects are handled by 'resolvePendingAction'
        // This function just handles the immediate turn advance
        case 'Wild Swap':
        case 'Wild Pick Until':
            advanceTurn();
            break;

        default: // Number card
            advanceTurn();
            break;
    }
}

function isPlayable(card, topCard) {
    if (!topCard) return true; // First card
    if (card.color === 'Black') return true; // Wilds are always playable
    if (card.color === gameState.currentColor) return true;
    if (card.value === topCard.value) return true;
    return false;
}

function calculateScore(hand) {
    return hand.reduce((score, card) => score + (CARD_POINTS[card.value] || 0), 0);
}

// --- Core Game Logic ---
function initializeGame(readyPlayers, settings) {
    addLog('Initializing new game of UNO...');

    const gamePlayers = readyPlayers.map((p, index) => ({
        playerId: p.playerId,
        name: p.name,
        socketId: p.socketId,
        isHost: p.isHost,
        status: 'Active', // 'Active', 'Disconnected', 'Removed'
        hand: [],
        score: 0,
        unoState: 'none', // 'none', 'declared', 'missed'
        isDealer: index === 0, // First player is the first dealer
    }));

    gameState = {
        players: gamePlayers,
        drawPile: [],
        discardPile: [],
        currentPlayerId: gamePlayers[0].playerId,
        currentColor: '',
        turnDirection: 1, // 1 for clockwise, -1 for counter-clockwise
        logHistory: ['Game initialized.'],
        settings: {
            ...settings,
            cardsToDeal: settings.cardsToDeal || CARDS_TO_DEAL
        },
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        pendingAction: null, // For multi-step actions
        pendingWin: null, // For wins delayed by actions
        currentRound: 0,
    };

    io.emit('gameStarted');
    startNewRound();
}

function startNewRound() {
    if (!gameState) return;

    gameState.currentRound++;
    addLog(`--- Starting Round ${gameState.currentRound} ---`);

    // Find the dealer
    let dealerIndex = gameState.players.findIndex(p => p.isDealer);
    if (dealerIndex === -1) dealerIndex = 0; // Default to first player if not found

    // Set the next dealer
    gameState.players.forEach(p => p.isDealer = false);
    let nextDealerIndex = getNextPlayerIndex(dealerIndex);
    gameState.players[nextDealerIndex].isDealer = true;
    
    const dealer = gameState.players[dealerIndex];
    addLog(`${dealer.name} is the dealer.`);

    // Reset piles and hands
    initializeDeck();
    gameState.players.forEach(p => {
        p.hand = [];
        p.unoState = 'none';
        p.status = 'Active'; // Reset status for active players
    });

    // Deal cards
    const dealAmount = parseInt(gameState.settings.cardsToDeal, 10) || 7;
    let dealIndex = getNextPlayerIndex(dealerIndex); // Start with player after dealer

    for (let i = 0; i < dealAmount; i++) {
        for (let j = 0; j < getActivePlayers().length; j++) {
            const player = gameState.players[dealIndex];
            if (player.status === 'Active') {
                drawCards(player, 1);
            }
            dealIndex = getNextPlayerIndex(dealIndex);
        }
    }
    
    // Set starting player
    let firstPlayerIndex = getNextPlayerIndex(dealerIndex);
    gameState.currentPlayerId = gameState.players[firstPlayerIndex].playerId;
    
    // Start the first card
    startFirstCard();

    io.emit('updateGameState', gameState);
}

function endRound(winner) {
    if (!gameState) return;

    // *** MODIFIED: Create finalHands object ***
    let finalHands = {};
    let scoreboard = [];
    let roundWinnerScore = 0;

    gameState.players.forEach(p => {
        let roundScore = 0;
        if (p.playerId !== winner.playerId) {
            roundScore = calculateScore(p.hand);
            roundWinnerScore += roundScore;
        }
        p.score += roundScore; // Add to cumulative score
        
        // Add to scoreboard
        scoreboard.push({
            name: p.name,
            roundScore: roundScore,
            cumulativeScore: p.score
        });

        // *** NEW: Store hand for final display ***
        finalHands[p.playerId] = [...p.hand];
    });

    scoreboard.sort((a, b) => a.cumulativeScore - b.cumulativeScore);

    addLog(`Round ${gameState.currentRound} over. Winner: ${winner.name}`);
    
    const currentHost = gameState.players.find(p => p.isHost && p.status !== 'Removed');
    const hostId = currentHost ? currentHost.playerId : null;

    // *** MODIFIED: Add a short delay before sending round over info ***
    setTimeout(() => {
        if (!gameState) return; // Game might have reset
        io.emit('roundOver', {
            scoreboard: scoreboard,
            winnerName: winner.name,
            roundNumber: gameState.currentRound,
            hostId: hostId,
            finalHands: finalHands // *** NEW ***
        });
        
        // Set state to between-rounds
        gameState.currentPlayerId = null;
    }, 500); // 500ms delay to allow win to register
}

function endSession(wasGameAborted = false) {
    if (!gameState) {
        hardReset(); // If no game, just reset
        return;
    }

    addLog('The game session is ending...');

    let minScore = Infinity;
    let winners = [];
    
    if (!wasGameAborted) {
        gameState.players.filter(p => p.status !== 'Removed').forEach(p => {
            if (p.score < minScore) {
                minScore = p.score;
                winners = [p.name];
            } else if (p.score === minScore) {
                winners.push(p.name);
            }
        });
    }

    // *** MODIFIED: Ported SOH Game End Flow ***
    
    // 1. Emit the winner announcement immediately
    io.emit('gameOverAnnouncement', { winnerNames: winners });

    // 2. After 12 seconds (for animation), send the final 'gameEnded' modal data
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
    gameOverCleanupTimer = setTimeout(() => {
        if (!gameState) return; // Server may have reset
        addLog('The game session has ended.');
        io.emit('gameEnded', {
            logHistory: gameState.logHistory,
            scoreboard: gameState.players.map(p => ({ name: p.name, score: p.score })).sort((a,b) => a.score - b.score),
            winnerNames: winners
        });

        // 3. After another 12 seconds (for modal), reset to lobby
        if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = setTimeout(() => {
            if (!gameState) return; // Check again
            
            // Rebuild lobby 'players' array from 'gameState.players'
            players = gameState.players
                .filter(p => p.status !== 'Removed') // Filter out removed players
                .map(p => ({
                    playerId: p.playerId,
                    socketId: p.socketId,
                    name: p.name,
                    isHost: p.isHost,
                    isReady: p.isHost, // Host is ready by default
                    active: p.status === 'Active'
                }));

            // Clear game state
            gameState = null;
            Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
            
            io.emit('lobbyUpdate', players);

        }, 12000); // 12 seconds for players to view the final modal

    }, 12000); // 12 seconds for the winner animation to play
}


function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const playerToRemove = getPlayer(playerId);

    if (playerToRemove && playerToRemove.status !== 'Removed') {
        playerToRemove.status = 'Removed';
        addLog(`Player ${playerToRemove.name} was removed from the game.`);
        delete reconnectTimers[playerId];
        
        // Check if game can continue
        const activePlayers = getActivePlayers();
        if (activePlayers.length < 2) {
            addLog('Not enough players to continue. Ending game.');
            endSession(true); // Abort game
            return;
        }

        // Handle host departure
        if (playerToRemove.isHost) {
            const newHost = activePlayers[0];
            if (newHost) {
                newHost.isHost = true;
                addLog(`${newHost.name} is the new host.`);
            }
        }

        // If the removed player was the current player, advance turn
        if (gameState.currentPlayerId === playerId) {
            advanceTurn();
        }
        
        // Check if game was paused for this player
        const stillDisconnected = gameState.players.some(p => p.status === 'Disconnected');
        if (!stillDisconnected) {
            gameState.isPaused = false;
            gameState.pausedForPlayerNames = [];
            gameState.pauseEndTime = null;
            addLog("All players reconnected or removed. Game resumed.");
        } else {
             gameState.pausedForPlayerNames = gameState.players
                .filter(p => p.status === 'Disconnected')
                .map(p => p.name);
        }
        
        io.emit('updateGameState', gameState);
    }
}

function hardReset() {
    console.log("Hard reset triggered.");
    
    // Disconnect all sockets
    const sockets = io.sockets.sockets;
    sockets.forEach((socket, socketId) => {
        // Check if this socket is in the lobby or in the game
        const inLobby = players.some(p => p.socketId === socketId);
        const inGame = gameState?.players.some(p => p.socketId === socketId);
        
        if(inLobby || inGame) {
             console.log(`Forcing disconnect for socket ${socketId}`);
             socket.emit('forceDisconnect');
             socket.disconnect(true); // Force disconnect
        }
    });

    // Wipe server state
    gameState = null;
    players = [];
    
    Object.keys(reconnectTimers).forEach(key => {
        clearTimeout(reconnectTimers[key]);
        delete reconnectTimers[key];
    });
    if (gameOverCleanupTimer) {
        clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = null;
    }

    console.log("Server state wiped.");
}

// --- Socket.IO Event Handlers ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            // --- Reconnection Logic ---
            let playerToRejoin = null;
            
            // Try to find by persistent ID first
            if (playerId) {
                playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
            }
            // If not found, try to find by name (fallback)
            if (!playerToRejoin && playerName) {
                playerToRejoin = gameState.players.find(p => p.name.toLowerCase() === playerName.toLowerCase() && p.status === 'Disconnected');
            }

            if (playerToRejoin) {
                playerToRejoin.status = 'Active';
                playerToRejoin.socketId = socket.id;
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];

                addLog(`Player ${playerToRejoin.name} has reconnected!`);

                const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
                if (stillDisconnected.length === 0) {
                    gameState.isPaused = false;
                    gameState.pausedForPlayerNames = [];
                    gameState.pauseEndTime = null;
                    addLog('All players reconnected. Game resumed.');
                } else {
                    gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name);
                }
                
                socket.emit('joinSuccess', playerToRejoin.playerId);
                io.emit('updateGameState', gameState);
            } else {
                // Player is not in the game or is already active
                socket.emit('joinFailed', 'Game in progress and you are not a disconnected player.');
            }
        } else {
            // --- Lobby Logic ---
            let existingPlayer = null;
            
             // Check if name is already taken by an active lobby player
             let nameExists = players.some(p => p.name.toLowerCase() === playerName.toLowerCase() && p.active);
             if (nameExists) {
                socket.emit('joinFailed', `Name "${playerName}" is already taken.`);
                return;
             }

            // Check if this socket is already in the lobby
            existingPlayer = players.find(p => p.socketId === socket.id);

            if (existingPlayer) {
                // Socket is already here, just update name and set to active
                existingPlayer.name = playerName;
                existingPlayer.active = true;
            } else {
                // New player joining
                const newPlayer = {
                    playerId: `${socket.id}-${Date.now()}`,
                    name: playerName,
                    socketId: socket.id,
                    isHost: players.length === 0,
                    isReady: false,
                    active: true
                };
                if (newPlayer.isHost) newPlayer.isReady = true; // Host is always ready
                
                players.push(newPlayer);
                socket.emit('joinSuccess', newPlayer.playerId);
            }

            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('setPlayerReady', (isReady) => {
        const player = players.find(p => p.socketId === socket.id);
        if (player) {
            player.isReady = isReady;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('kickPlayer', (playerIdToKick) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (requester && requester.isHost) {
            const playerToKick = players.find(p => p.playerId === playerIdToKick);
            if (playerToKick) {
                // Notify the kicked player
                io.to(playerToKick.socketId).emit('forceDisconnect');
                // Remove from lobby
                players = players.filter(p => p.playerId !== playerIdToKick);
                io.emit('lobbyUpdate', players);
            }
        }
    });

    socket.on('startGame', ({ hostPassword, settings }) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (!requester || !requester.isHost) return;

        // Check host password if it's set in environment variables
        if (process.env.HOST_PASSWORD && hostPassword !== process.env.HOST_PASSWORD) {
            socket.emit('warning', 'Invalid Host Password.');
            return;
        }

        const readyPlayers = players.filter(p => p.isReady && p.active);
        
        if (readyPlayers.length < 2) {
            socket.emit('warning', 'You need at least 2 ready players to start.');
            return;
        }

        initializeGame(readyPlayers, settings);
    });

    socket.on('playCard', (cardId) => {
        if (!gameState || gameState.isPaused || gameState.pendingAction) return;
        const player = getPlayer(gameState.currentPlayerId);
        if (!player || player.socketId !== socket.id) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return; // Card not in hand

        const card = player.hand[cardIndex];
        const topCard = gameState.discardPile[gameState.discardPile.length - 1];

        if (isPlayable(card, topCard)) {
            // Check for missed UNO
            if (player.hand.length === 2 && player.unoState !== 'declared') {
                player.unoState = 'missed';
                addLog(`${player.name} forgot to call UNO! Penalized 2 cards.`);
                drawCards(player, 2);
                io.emit('updateGameState', gameState);
                // Player is penalized but still gets to play their card
            }
            
            // Player is safe to play
            player.hand.splice(cardIndex, 1);
            gameState.discardPile.push(card);
            player.unoState = 'none'; // Reset uno state after playing
            
            addLog(`${player.name} played a ${card.color} ${card.value}.`);

            // Check for win
            if (player.hand.length === 0) {
                // If the card has a pending action, delay the win
                if (card.color === 'Black') {
                    gameState.pendingWin = player.playerId; // Store who won
                } else {
                    endRound(player);
                    return; // Round is over, no more actions
                }
            }

            // Handle card type
            if (card.color === 'Black') {
                // Wild card played, requires player action
                let actionType = '';
                if (card.value === 'Wild') actionType = 'choose-color';
                if (card.value === 'Wild Draw Four') actionType = 'choose-color';
                if (card.value === 'Wild Swap') actionType = 'wild-swap';
                if (card.value === 'Wild Pick Until') actionType = 'wild-pick-until';

                gameState.pendingAction = {
                    type: actionType,
                    playerSocketId: socket.id,
                    card: card
                };
                // Emit the specific action to the client
                socket.emit(actionType, card);
            } else {
                // Regular card, resolve effects immediately
                gameState.currentColor = card.color;
                handleCardEffects(card, player.playerId);
            }
            
            io.emit('updateGameState', gameState);

        } else {
            socket.emit('warning', 'Invalid move.');
        }
    });

    socket.on('drawCard', () => {
        if (!gameState || gameState.isPaused || gameState.pendingAction) return;
        const player = getPlayer(gameState.currentPlayerId);
        if (!player || player.socketId !== socket.id) return;

        if (gameState.drawPile.length === 0) {
            reshuffleDiscardPile();
            if (gameState.drawPile.length === 0) {
                addLog('No more cards to draw!');
                socket.emit('warning', 'No more cards in the deck to draw!');
                return;
            }
        }

        const drawnCard = gameState.drawPile.pop();
        
        // Check if the drawn card is a Wild card and is playable
        const topCard = gameState.discardPile[gameState.discardPile.length - 1];
        if (drawnCard.color === 'Black' && isPlayable(drawnCard, topCard)) {
            // It's a Wild card. Give the player the choice to play it.
            gameState.pendingAction = {
                type: 'wild-draw-choice',
                playerSocketId: socket.id,
                card: drawnCard
            };
            socket.emit('wildDrawChoice', drawnCard);
        
        } else if (isPlayable(drawnCard, topCard)) {
            // It's a regular (non-wild) card and it's playable. Auto-play it.
            gameState.discardPile.push(drawnCard);
            addLog(`${player.name} drew and auto-played a ${drawnCard.color} ${drawnCard.value}.`);
            gameState.currentColor = drawnCard.color;
            handleCardEffects(drawnCard, player.playerId);

        } else {
            // Card is not playable, add to hand and advance turn.
            player.hand.push(drawnCard);
            addLog(`${player.name} drew a card.`);
            advanceTurn();
        }
        
        player.unoState = 'none'; // Drawing resets UNO state
        io.emit('updateGameState', gameState);
    });

    socket.on('declareUNO', () => {
        if (!gameState) return;
        const player = getPlayer(socket.handshake.query.playerId); // Find by persistent ID
        if (!player) {
            // Fallback for socket id if query is not set (e.g. older client)
             const playerBySocket = gameState.players.find(p => p.socketId === socket.id);
             if (playerBySocket) playerBySocket.unoState = 'declared';
             return;
        }

        if (player && player.hand.length === 2) {
            player.unoState = 'declared';
            addLog(`${player.name} declared UNO!`);
            io.emit('updateGameState', gameState);
        }
    });

    socket.on('resolvePendingAction', (data) => {
        if (!gameState || !gameState.pendingAction || gameState.pendingAction.playerSocketId !== socket.id) return;

        const player = getPlayer(gameState.currentPlayerId); // This should be the player *after* the one who played
        const actionPlayer = gameState.players.find(p => p.socketId === socket.id); // This is the player who played the card
        const card = gameState.pendingAction.card;

        switch(gameState.pendingAction.type) {
            case 'choose-color':
                gameState.currentColor = data.color;
                addLog(`${actionPlayer.name} chose the color ${data.color}.`);
                handleCardEffects(card, actionPlayer.playerId);
                break;
            
            case 'wild-draw-choice':
                if (data.play) {
                    // Player chose to PLAY the drawn Wild
                    gameState.discardPile.push(card);
                    addLog(`${actionPlayer.name} drew and played a ${card.color} ${card.value}.`);
                    
                    // Check for win on playing the drawn card
                    if (actionPlayer.hand.length === 0) {
                        gameState.pendingWin = actionPlayer.playerId;
                    }

                    // This card now needs its *own* action resolved
                    let actionType = '';
                    if (card.value === 'Wild') actionType = 'choose-color';
                    if (card.value === 'Wild Draw Four') actionType = 'choose-color';
                    if (card.value === 'Wild Swap') actionType = 'wild-swap';
                    if (card.value === 'Wild Pick Until') actionType = 'wild-pick-until';

                    gameState.pendingAction = {
                        type: actionType,
                        playerSocketId: socket.id,
                        card: card
                    };
                    socket.emit(actionType, card);
                    // Do NOT advance turn here, wait for the *next* resolution
                } else {
                    // Player chose to KEEP the card
                    actionPlayer.hand.push(card);
                    addLog(`${actionPlayer.name} drew and kept a card.`);
                    advanceTurn(); // Turn ends
                    gameState.pendingAction = null;
                }
                break;

            case 'wild-swap':
                gameState.currentColor = data.color;
                const targetPlayer = getPlayer(data.targetPlayerId);
                if (targetPlayer) {
                    // Swap hands
                    const tempHand = actionPlayer.hand;
                    actionPlayer.hand = targetPlayer.hand;
                    targetPlayer.hand = tempHand;
                    addLog(`${actionPlayer.name} chose ${data.color} and swapped hands with ${targetPlayer.name}.`);
                }
                handleCardEffects(card, actionPlayer.playerId);
                break;
            
            case 'wild-pick-until':
                gameState.currentColor = data.color;
                if (data.action === 'pick') {
                    // Next player picks until color
                    advanceTurn(); // Advance to the target player
                    const targetPickPlayer = getPlayer(gameState.currentPlayerId);
                    if (targetPickPlayer) {
                        addLog(`${actionPlayer.name} chose ${data.color}. ${targetPickPlayer.name} must draw until they find that color.`);
                        let drawnCard;
                        let cardsDrawnCount = 0;
                        do {
                            if (gameState.drawPile.length === 0) reshuffleDiscardPile();
                            if (gameState.drawPile.length === 0) {
                                addLog(`No ${data.color} cards left! ${targetPickPlayer.name} drew all cards.`);
                                break; // Deck is empty
                            }
                            drawnCard = gameState.drawPile.pop();
                            cardsDrawnCount++;
                            if (drawnCard.color !== data.color && drawnCard.color !== 'Black') {
                                targetPickPlayer.hand.push(drawnCard);
                            }
                        } while (drawnCard.color !== data.color && drawnCard.color !== 'Black');

                        // If a matching card was found, auto-play it
                        if (drawnCard.color === data.color || drawnCard.color === 'Black') {
                            gameState.discardPile.push(drawnCard);
                            addLog(`${targetPickPlayer.name} drew ${cardsDrawnCount} cards and auto-played a ${drawnCard.color} ${drawnCard.value}.`);
                            
                            // If this auto-played card is Wild, it needs its *own* resolution
                            if (drawnCard.color === 'Black') {
                                // Check for win (unlikely, but possible)
                                if (targetPickPlayer.hand.length === 0) {
                                    gameState.pendingWin = targetPickPlayer.playerId;
                                }
                                let actionType = '';
                                if (drawnCard.value === 'Wild') actionType = 'choose-color';
                                if (drawnCard.value === 'Wild Draw Four') actionType = 'choose-color';
                                if (drawnCard.value === 'Wild Swap') actionType = 'wild-swap';
                                if (drawnCard.value === 'Wild Pick Until') actionType = 'wild-pick-until';

                                gameState.pendingAction = {
                                    type: actionType,
                                    playerSocketId: targetPickPlayer.socketId,
                                    card: drawnCard
                                };
                                io.to(targetPickPlayer.socketId).emit(actionType, drawnCard);
                                // Do NOT advance turn
                            } else {
                                // Auto-played card was regular color, resolve its effects and advance
                                gameState.currentColor = drawnCard.color;
                                handleCardEffects(drawnCard, targetPickPlayer.playerId);
                                // This advances turn *past* the next player
                            }
                        }
                    }
                } else if (data.action === 'discard') {
                    // All OTHER players discard wilds
                    addLog(`${actionPlayer.name} chose ${data.color}. All other players must discard Wilds!`);
                    let jointWinners = [];
                    gameState.players.forEach(p => {
                        if (p.playerId !== actionPlayer.playerId) {
                            let newHand = [];
                            p.hand.forEach(c => {
                                if (c.color === 'Black') {
                                    // Mark as a non-shufflable discard
                                    c.isDiscardedWild = true; 
                                    gameState.discardPile.push(c);
                                    addLog(`${p.name} discarded a ${c.value}.`);
                                } else {
                                    newHand.push(c);
                                }
                            });
                            p.hand = newHand;
                            // Check if this action made them win
                            if (p.hand.length === 0) {
                                jointWinners.push(p);
                            }
                        }
                    });

                    // Handle joint winners
                    if (jointWinners.length > 0) {
                         // For now, just pick the first one.
                         // TODO: Handle multiple winners properly
                         addLog(`Players ${jointWinners.map(p=>p.name).join(', ')} won by discarding their last card!`);
                         endRound(jointWinners[0]);
                         return; // End round
                    }
                    
                    handleCardEffects(card, actionPlayer.playerId); // Advance turn
                }
                break;
        }

        // Clear pending action
        if (gameState.pendingAction && gameState.pendingAction.type !== 'choose-color' && gameState.pendingAction.type !== 'wild-swap' && gameState.pendingAction.type !== 'wild-pick-until') {
            gameState.pendingAction = null;
        }

        // Check for delayed win
        if (gameState.pendingWin) {
            const winner = getPlayer(gameState.pendingWin);
            if (winner) {
                endRound(winner);
                gameState.pendingWin = null;
                return;
            }
        }
        
        io.emit('updateGameState', gameState);
    });

    socket.on('requestNextRound', () => {
        if (!gameState) return;
        const player = getPlayer(socket.handshake.query.playerId);
        if (!player) player = gameState.players.find(p => p.socketId === socket.id);

        if (player && player.isHost) {
            startNewRound();
        }
    });

    socket.on('markPlayerAFK', (playerIdToMark) => {
        if (!gameState) return;
        const requester = getPlayer(socket.handshake.query.playerId) || gameState.players.find(p => p.socketId === socket.id);
        const playerToMark = getPlayer(playerIdToMark);

        if (requester && requester.isHost && playerToMark && playerToMark.status === 'Active') {
            playerToMark.status = 'Disconnected';
            addLog(`Host marked ${playerToMark.name} as AFK. The game is paused.`);
            gameState.isPaused = true;
            gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
            gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
            
            // Start a timer for this player
            if (reconnectTimers[playerToMark.playerId]) clearTimeout(reconnectTimers[playerToMark.playerId]);
            reconnectTimers[playerToMark.playerId] = setTimeout(() => {
                handlePlayerRemoval(playerToMark.playerId);
            }, DISCONNECT_GRACE_PERIOD);

            io.emit('updateGameState', gameState);
            
            // Notify the player who was marked
            const afkSocket = io.sockets.sockets.get(playerToMark.socketId);
            if (afkSocket) {
                afkSocket.emit('youWereMarkedAFK');
            }
        }
    });

    socket.on('playerIsBack', () => {
        if (!gameState) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player && player.status === 'Disconnected') {
            player.status = 'Active';
            clearTimeout(reconnectTimers[player.playerId]);
            delete reconnectTimers[player.playerId];

            addLog(`Player ${player.name} is back!`);

            const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (stillDisconnected.length === 0) {
                gameState.isPaused = false;
                gameState.pausedForPlayerNames = [];
                gameState.pauseEndTime = null;
                addLog('All players back. Game resumed.');
            } else {
                gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name);
            }
            io.emit('updateGameState', gameState);
        }
    });

    socket.on('endSession', () => {
        let isHost = false;
        
        if (gameState) {
            const playerInGame = getPlayer(socket.handshake.query.playerId) || gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) {
                isHost = true;
            }
        } else {
             // No game in progress, check lobby
             const playerInLobby = players.find(p => p.socketId === socket.id);
             if (playerInLobby && playerInLobby.isHost) {
                 // Don't allow ending session from lobby, only hard reset
                 isHost = false; 
             }
        }

        if (isHost) {
            endSession(false); // Not an abort
        }
    });
    
    socket.on('hardReset', () => {
         let isHost = false;
         if (gameState?.players) {
            const playerInGame = getPlayer(socket.handshake.query.playerId) || gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) isHost = true;
         }
         if (!isHost && players) {
            const playerInLobby = players.find(p => p.socketId === socket.id);
            if (playerInLobby && playerInLobby.isHost) isHost = true;
         }

         if (isHost) {
            hardReset();
         }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (gameState) {
            // --- Game Disconnect ---
            const playerInGame = gameState.players.find(p => p.socketId === socket.id && p.status === 'Active');
            if (playerInGame) {
                playerInGame.status = 'Disconnected';
                addLog(`Player ${playerInGame.name} has disconnected. The game is paused.`);
                gameState.isPaused = true;
                gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
                gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
                
                // Start a timer to remove the player
                if (reconnectTimers[playerInGame.playerId]) clearTimeout(reconnectTimers[playerInGame.playerId]);
                reconnectTimers[playerInGame.playerId] = setTimeout(() => {
                    handlePlayerRemoval(playerInGame.playerId);
                }, DISCONNECT_GRACE_PERIOD);
                
                io.emit('updateGameState', gameState);
            }
        } else {
            // --- Lobby Disconnect ---
            const disconnectedPlayerIndex = players.findIndex(p => p.socketId === socket.id);
            if (disconnectedPlayerIndex !== -1) {
                 const disconnectedPlayer = players[disconnectedPlayerIndex];
                 console.log(`Player ${disconnectedPlayer.name} left lobby.`);
                 const wasHost = disconnectedPlayer.isHost;
                 players.splice(disconnectedPlayerIndex, 1); // Remove player

                 // If host left and there are other players, assign a new host
                 if (wasHost && players.length > 0) {
                     players[0].isHost = true;
                     players[0].isReady = true; // New host is auto-ready
                     console.log(`New host is ${players[0].name}`);
                 }
                 io.emit('lobbyUpdate', players);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));