const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SERVER-SIDE GAME STATE ---
let players = []; // Lobby players { playerId, name, isHost }
let gameState = null;
let reconnectTimers = {}; // *** NEW: Stores individual timers { playerId: timeoutId }
const DISCONNECT_GRACE_PERIOD = 60000; // *** NEW: 60 seconds

// --- GAME LOGIC FUNCTIONS (The Server's Brain) ---

// *** NEW: Helper to send log messages to all clients ***
function addLog(message) {
    if (io) {
        io.emit('gameLog', message);
    }
}

function createDeck() {
    const deck = [];
    const colors = ['Red', 'Green', 'Blue', 'Yellow'];
    const values = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw Two'];

    for (const color of colors) {
        deck.push({ color, value: '0' });
        for (let i = 0; i < 2; i++) {
            for (const value of values) {
                deck.push({ color, value });
            }
        }
    }

    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'Black', value: 'Wild' });
        deck.push({ color: 'Black', value: 'Wild Draw Four' });
        deck.push({ color: 'Black', value: 'Wild Pick Until' });
    }
    deck.push({ color: 'Black', value: 'Wild Swap' });

    return deck;
}

function calculateScore(hand) {
    let score = 0;
    hand.forEach(card => {
        if (!isNaN(card.value)) {
            score += parseInt(card.value);
        } else {
            switch(card.value) {
                case 'Wild Swap':
                    score += 100;
                    break;
                case 'Draw Two':
                    score += 25;
                    break;
                case 'Skip':
                case 'Reverse':
                    score += 20;
                    break;
                default: // Catches all other Wild cards
                    score += 50;
                    break;
            }
        }
    });
    return score;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function setupGame(lobbyPlayers) {
    const gamePlayers = lobbyPlayers.map(p => ({
        playerId: p.playerId,
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        score: 0,
        hand: [],
        unoState: 'safe',
        scoresByRound: [],
        status: 'Active' // <-- This is perfect
    }));
    return {
        players: gamePlayers,
        dealerIndex: -1,
        numCardsToDeal: 7,
        discardPile: [],
        drawPile: [],
        gameWinner: null,
        winnerOnHold: [],
        roundNumber: 0,
        isPaused: false, // *** RENAMED: from isSuspended
        pauseInfo: { // *** NEW: Replaces suspensionInfo
            pauseEndTime: null,
            pausedForPlayerNames: []
        },
        readyForNextRound: [],
    };
}

function startNewRound(gs) {
    gs.roundNumber++;
    const numPlayers = gs.players.length;

    let roundDeck = shuffleDeck(createDeck());
    gs.players.forEach(player => {
        if (player.status === 'Active') { 
            player.hand = roundDeck.splice(0, gs.numCardsToDeal);
            player.unoState = 'safe';
        } else {
            player.hand = []; // Ensure non-active players have no cards
        }
    });

    let topCard = roundDeck.shift();

    while (topCard.value === 'Wild Draw Four' || topCard.value === 'Wild Swap') {
        roundDeck.push(topCard);
        roundDeck = shuffleDeck(roundDeck);
        topCard = roundDeck.shift();
    }

    gs.discardPile = [topCard];
    gs.drawPile = roundDeck;
    gs.activeColor = topCard.color;
    gs.playDirection = 1;
    gs.drawPenalty = 0;
    gs.needsColorChoice = null;
    gs.needsPickUntilChoice = null;
    gs.pickUntilState = null;
    gs.needsSwapChoice = null;
    gs.swapState = null;
    gs.roundOver = false;
    gs.needsDealChoice = null;
    gs.winnerOnHold = [];
    gs.isPaused = false; // *** RENAMED: from isSuspended
    gs.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] }; // *** NEW
    gs.readyForNextRound = [];

    const dealer = gs.players[gs.dealerIndex];
    addLog(`Round ${gs.roundNumber} begins. ${dealer.name} deals ${gs.numCardsToDeal} cards.`);

    let firstPlayerIndex = (gs.dealerIndex + 1) % numPlayers;
    while (gs.players[firstPlayerIndex].status !== 'Active') {
        firstPlayerIndex = (firstPlayerIndex + 1) % numPlayers;
    }

    if (topCard.color !== 'Black') {
        const connectedPlayersCount = gs.players.filter(p => p.status === 'Active').length;

        if (topCard.value === 'Reverse') {
            if (connectedPlayersCount > 2) {
                gs.playDirection = -1;
                let tempIndex = gs.dealerIndex;
                do {
                    tempIndex = (tempIndex - 1 + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                firstPlayerIndex = tempIndex;
            } else { // 2-player reverse acts as a skip
                let tempIndex = firstPlayerIndex;
                do {
                    tempIndex = (tempIndex + 1 + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                firstPlayerIndex = tempIndex;
            }
        } else if (topCard.value === 'Skip') {
            let tempIndex = firstPlayerIndex;
            do {
                tempIndex = (tempIndex + 1 + numPlayers) % numPlayers;
            } while (gs.players[tempIndex].status !== 'Active');
            firstPlayerIndex = tempIndex;
        }
        if (topCard.value === 'Draw Two') {
            applyCardEffect(topCard);
        }
    } else {
        gs.needsColorChoice = dealer.playerId;
        if (topCard.value === 'Wild Pick Until') {
            gs.needsPickUntilChoice = dealer.playerId;
        }
    }

    gs.currentPlayerIndex = firstPlayerIndex;

    return gs;
}


function isMoveValid(playedCard, topCard, activeColor, drawPenalty) {
    if (drawPenalty > 0) {
        return playedCard.value === topCard.value;
    }
    if (playedCard.color === 'Black') return true;
    if (playedCard.color === activeColor || playedCard.value === topCard.value) return true;
    return false;
}

function advanceTurn() {
    if (!gameState || gameState.roundOver) return;

    const activePlayers = gameState.players.filter(p => p.status === 'Active');
    if (activePlayers.length === 0) {
        addLog("No active players left to advance turn.");
        return; // No active players
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer && currentPlayer.unoState === 'declared') {
        currentPlayer.unoState = 'safe';
    }

    do {
        const numPlayers = gameState.players.length;
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + gameState.playDirection + numPlayers) % numPlayers;
    } while (gameState.players[gameState.currentPlayerIndex].status !== 'Active');
}

function applyCardEffect(playedCard) {
    const numPlayers = gameState.players.length;
    switch(playedCard.value) {
        case 'Reverse':
            if (gameState.players.filter(p=>p.status === 'Active').length > 2) {
                gameState.playDirection *= -1;
            }
            break;
        case 'Draw Two':
        case 'Wild Draw Four':
            const penalty = (playedCard.value === 'Draw Two') ? 2 : 4;
            gameState.drawPenalty += penalty;
            break;
    }
}

function handleEndOfRound(winners) {
    if (gameState.roundOver) return;
    gameState.roundOver = true;
    gameState.readyForNextRound = []; // Reset readiness
    const scoresForRound = [];

    gameState.players.forEach(p => {
        // Score 'Active' or 'Disconnected', not 'Removed'
        const roundScore = (p.status === 'Active' || p.status === 'Disconnected') ? calculateScore(p.hand) : 0;
        p.score += roundScore;
        // Log score for 'Active' or 'Disconnected'
        p.scoresByRound.push((p.status === 'Active' || p.status === 'Disconnected') ? roundScore : '-');
        scoresForRound.push({ name: p.name, roundScore: roundScore, cumulativeScore: p.score });
    });

    const winnerNames = winners.map(w => w.name).join(' and ');
    addLog(`🏁 ${winnerNames} wins the round!`);

    io.emit('roundOver', {
        winnerName: winnerNames,
        scores: scoresForRound,
        finalGameState: gameState
    });
}


function handleCardPlay(playerIndex, cardIndex) {
    // *** RENAMED: isSuspended to isPaused
    if (!gameState || playerIndex !== gameState.currentPlayerIndex || gameState.roundOver || gameState.isPaused) return;
    const player = gameState.players[playerIndex];
    if (!player || !player.hand[cardIndex]) return;

    const playedCard = player.hand[cardIndex];
    const topCard = gameState.discardPile[0];
    const actionCardsThatDelayWin = ['Draw Two', 'Wild Draw Four', 'Wild Pick Until'];

    if (isMoveValid(playedCard, topCard, gameState.activeColor, gameState.drawPenalty)) {
        io.emit('animatePlay', { playerId: player.playerId, card: playedCard, cardIndex: cardIndex });

        player.hand.splice(cardIndex, 1);

        const cardName = `${playedCard.color !== 'Black' ? playedCard.color + ' ' : ''}${playedCard.value}`;
        addLog(`› ${player.name} played a ${cardName}.`);

        if (player.hand.length === 0) {
            if (actionCardsThatDelayWin.includes(playedCard.value)) {
                gameState.winnerOnHold.push(player.playerId);
            } else {
                handleEndOfRound([player]);
                return;
            }
        }

        if (player.hand.length === 1 && player.unoState !== 'declared') {
            if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            player.unoState = 'safe';
            io.to(player.socketId).emit('announce', 'Penalty! You forgot to call UNO.');
            addLog(` penalty on ${player.name} for not calling UNO.`);
            io.emit('animateDraw', { playerId: player.playerId, count: 2 });


        } else if (player.hand.length === 1 && player.unoState === 'declared') {
            io.emit('unoCalled', { playerName: player.name });
            player.unoState = 'safe';

        } else if (player.hand.length > 1) {
            player.unoState = 'safe';
        }


        gameState.discardPile.unshift(playedCard);

        if (playedCard.value === 'Wild Pick Until') {
            gameState.needsPickUntilChoice = player.playerId;
            return;
        } else if (playedCard.value === 'Wild Swap') {
            gameState.swapState = { choosingPlayerId: player.playerId };
            gameState.needsColorChoice = player.playerId;
            return;
        }

        applyCardEffect(playedCard);

        if (playedCard.value === 'Skip' || (playedCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) {
            advanceTurn();
        }

        if (playedCard.color === 'Black') {
            gameState.needsColorChoice = player.playerId;
        } else {
            gameState.activeColor = playedCard.color;
            advanceTurn();
        }
    }
}

// *** START: NEW PLAYER REMOVAL FUNCTION ***
function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const player = gameState.players.find(p => p.playerId === playerId);

    // Only remove if they are still 'Disconnected' (haven't rejoined)
    if (player && player.status === 'Disconnected') {
        player.status = 'Removed';
        addLog(`Player ${player.name} failed to reconnect and has been removed.`);

        // Clear their specific timer
        if (reconnectTimers[playerId]) {
            clearTimeout(reconnectTimers[playerId]);
            delete reconnectTimers[playerId];
        }

        // Host migration
        if (player.isHost) {
            const nextActivePlayer = gameState.players.find(p => p.status === 'Active');
            if (nextActivePlayer) {
                nextActivePlayer.isHost = true;
                addLog(`Host ${player.name} was removed. ${nextActivePlayer.name} is the new host.`);
            } else {
                addLog(`Host ${player.name} was removed. No active players left.`);
            }
        }

        // Check if game should end
        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2) {
            addLog('Less than 2 active players remaining. Game over.');
            io.emit('finalGameOver', gameState);
            gameState = null; // End the game
            reconnectTimers = {}; // Clear all timers
            return;
        }

        // Unpause game if this was the last disconnected player
        const remainingDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (remainingDisconnected.length === 0) {
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All disconnected players have been handled. Game resumed.");
        } else {
            // Update pause info if others are still disconnected
            gameState.pauseInfo.pausedForPlayerNames = remainingDisconnected.map(p => p.name);
        }
        
        // Advance turn if it was the removed player's turn
        if (!gameState.roundOver && gameState.players[gameState.currentPlayerIndex].playerId === playerId) {
            addLog(`It was ${player.name}'s turn. Advancing to next active player.`);
            advanceTurn();
        }
        
        io.emit('updateGameState', gameState);

    } else if (reconnectTimers[playerId]) {
        // Clean up timer if player reconnected just as it fired
        clearTimeout(reconnectTimers[playerId]);
        delete reconnectTimers[playerId];
    }
}
// *** END: NEW PLAYER REMOVAL FUNCTION ***

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinGame', ({ playerName, playerId }) => {
    if (gameState) {
        let playerToRejoin = null;
        if (playerId) {
            // Allow 'Disconnected' or 'Removed' to rejoin
            playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status !== 'Active');
        }

        // --- HYBRID RECONNECTION LOGIC (No changes needed) ---
        if (!playerToRejoin) {
            const disconnectedPlayers = gameState.players.filter(p => p.status !== 'Active');
            const joiningPlayerNameLower = playerName.toLowerCase();

            if (disconnectedPlayers.length === 1) {
                playerToRejoin = disconnectedPlayers[0];
            } else if (disconnectedPlayers.length > 1) {
                let bestMatch = null;
                let longestMatchLength = 0;
                for (const p of disconnectedPlayers) {
                    const disconnectedNameLower = p.name.toLowerCase();
                    if (joiningPlayerNameLower.startsWith(disconnectedNameLower)) {
                        if (disconnectedNameLower.length > longestMatchLength) {
                            bestMatch = p;
                            longestMatchLength = disconnectedNameLower.length;
                        }
                    }
                }
                playerToRejoin = bestMatch;
            }
        }
        // --- END OF LOGIC ---

        if (playerToRejoin) {
            console.log(`${playerName} is rejoining as ${playerToRejoin.name}.`);
            
            // *** START: RECONNECTION LOGIC ***
            playerToRejoin.status = 'Active'; 
            playerToRejoin.socketId = socket.id;
            playerToRejoin.name = playerName; // Update to latest name

            // Clear the removal timer for this player
            if (reconnectTimers[playerToRejoin.playerId]) {
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];
            }

            addLog(`Player ${playerToRejoin.name} has reconnected!`);

            // Check if we can unpause
            const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (otherDisconnected.length === 0) {
                gameState.isPaused = false;
                gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
                addLog("All players reconnected. Game resumed.");
            } else {
                // Update pause info
                gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
            }
            // *** END: RECONNECTION LOGIC ***

            socket.emit('joinSuccess', { playerId: playerToRejoin.playerId, lobby: gameState.players });
            io.emit('updateGameState', gameState);
            return;
        } else {
            socket.emit('announce', 'Game is in progress. Cannot join now.');
            return;
        }
    }

    // --- LOBBY JOIN LOGIC (No changes needed) ---
    let pId = playerId;
    if (!pId) {
        pId = Math.random().toString(36).substr(2, 9);
    }

    const existingPlayer = players.find(p => p.playerId === pId);
    if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.name = playerName;
    } else {
        const isHost = players.length === 0;
        players.push({ playerId: pId, socketId: socket.id, name: playerName, isHost });
    }

    socket.emit('joinSuccess', { playerId: pId, lobby: players });
    socket.broadcast.emit('lobbyUpdate', players);
  });

  // *** This handler is now partially redundant due to 'joinGame', but we'll keep its logic for safety ***
  socket.on('rejoinGame', (playerId) => {
    if (!gameState || !playerId) return;

    const playerToRejoin = gameState.players.find(p => p.playerId === playerId);
    if (playerToRejoin && playerToRejoin.status !== 'Active') {
        console.log(`${playerToRejoin.name} is rejoining the game.`);
        playerToRejoin.status = 'Active'; 
        playerToRejoin.socketId = socket.id;
        
        // *** START: RECONNECTION LOGIC ***
        if (reconnectTimers[playerToRejoin.playerId]) {
            clearTimeout(reconnectTimers[playerToRejoin.playerId]);
            delete reconnectTimers[playerToRejoin.playerId];
        }
        addLog(`Player ${playerToRejoin.name} has reconnected!`);

        const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (otherDisconnected.length === 0) {
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All players reconnected. Game resumed.");
        } else {
            gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
        }
        // *** END: RECONNECTION LOGIC ***

        io.emit('updateGameState', gameState);
    } else if (playerToRejoin && playerToRejoin.status === 'Active') {
        playerToRejoin.socketId = socket.id;
        socket.emit('updateGameState', gameState);
    }
  });

  // *** START: NEW KICK PLAYER HANDLER ***
  socket.on('kickPlayer', ({ playerIdToKick }) => {
    // Check if game is in progress
    if (gameState) return;

    // Find host
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host) {
        const playerToKick = players.find(p => p.playerId === playerIdToKick);
        if (playerToKick) {
            console.log(`Host ${host.name} kicked ${playerToKick.name}`);
            // Remove player from lobby
            players = players.filter(player => player.playerId !== playerIdToKick);
            // Broadcast new lobby state
            io.emit('lobbyUpdate', players);
        }
    }
  });
  // *** END: NEW KICK PLAYER HANDLER ***

  socket.on('startGame', () => {
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host && players.length >= 2) {
      gameState = setupGame(players);
      const newDealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
      const dealer = gameState.players[newDealerIndex];
      gameState.dealerIndex = newDealerIndex;
      gameState.needsDealChoice = dealer.playerId;
      io.emit('updateGameState', gameState);
    }
  });

  function checkAndStartNextRound() {
    if (!gameState) return;
    const host = gameState.players.find(p => p.isHost);
    const connectedPlayers = gameState.players.filter(p => p.status === 'Active');

    if (!host) return;

    const hostIsReady = gameState.readyForNextRound.includes(host.playerId);
    const allPlayersReady = gameState.readyForNextRound.length === connectedPlayers.length;

    if (hostIsReady && allPlayersReady) {
        const newDealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
        const dealer = gameState.players[newDealerIndex];
        gameState.dealerIndex = newDealerIndex;
        gameState.needsDealChoice = dealer.playerId;
        io.emit('updateGameState', gameState);
    }
  }

  socket.on('playerReadyForNextRound', () => {
      if (!gameState) return;
      const player = gameState.players.find(p => p.socketId === socket.id);
      if (player && !gameState.readyForNextRound.includes(player.playerId)) {
          gameState.readyForNextRound.push(player.playerId);
          checkAndStartNextRound();
          io.emit('updateGameState', gameState);
      }
  });


  socket.on('dealChoice', ({ numCards }) => {
    if (gameState.isPaused) return; // *** RENAMED
    const dealingPlayer = gameState.players.find(p => p.socketId === socket.id);
      if (gameState && gameState.needsDealChoice === dealingPlayer?.playerId) {
          const numToDeal = Math.max(1, Math.min(13, parseInt(numCards) || 7));
          gameState.numCardsToDeal = numToDeal;
          gameState = startNewRound(gameState);
          io.emit('updateGameState', gameState);
      }
  });

  socket.on('endGame', () => {
      if(gameState) {
          const player = gameState.players.find(p => p.socketId === socket.id);
          if (player && player.isHost) {
              io.emit('finalGameOver', gameState);
              addLog(`The game has been ended by the host.`);
              gameState = null;
              players = [];
              reconnectTimers = {};
          }
      }
  });

  socket.on('playCard', ({ cardIndex }) => {
    if (!gameState || gameState.isPaused) return; // *** RENAMED
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
        handleCardPlay(playerIndex, cardIndex);
        if (gameState && !gameState.roundOver) {
             io.emit('updateGameState', gameState);
        }
    }
  });

  socket.on('callUno', () => {
    if (!gameState || gameState.isPaused) return; // *** RENAMED
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (player && player.hand.length === 2) {
        player.unoState = 'declared';
        addLog(`📣 ${player.name} is ready to call UNO!`);
    }
  });


  socket.on('drawCard', () => {
    if (!gameState || gameState.roundOver || gameState.isPaused) return; // *** RENAMED
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);

    if (playerIndex === gameState.currentPlayerIndex) {
        const player = gameState.players[playerIndex];
        const topCard = gameState.discardPile[0];

        if (gameState.pickUntilState?.active && gameState.pickUntilState.targetPlayerIndex === playerIndex) {
            if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                player.hand.push(drawnCard);
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} is picking for a ${gameState.pickUntilState.targetColor}...`);
                if (drawnCard.color === gameState.pickUntilState.targetColor) {
                    player.hand.splice(player.hand.findIndex(c => c === drawnCard), 1);
                    gameState.discardPile.unshift(drawnCard);
                    gameState.activeColor = drawnCard.color;
                    io.to(socket.id).emit('announce', `You drew the target color (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                    addLog(`› ${player.name} found and played a ${drawnCard.color} card.`);

                    applyCardEffect(drawnCard);

                    if (player.hand.length === 0) {
                        const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                        handleEndOfRound([player, ...heldWinners]);
                        return;
                    }

                    if (gameState.winnerOnHold.length > 0) {
                        const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                        handleEndOfRound(heldWinners);
                        return;
                    }

                    gameState.pickUntilState = null;

                    if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) {
                        advanceTurn();
                    }
                    advanceTurn();
                }
            }
        } else if (gameState.drawPenalty > 0) {
            const penalty = gameState.drawPenalty;
            for (let i = 0; i < penalty; i++) {
                if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            }
            io.emit('animateDraw', { playerId: player.playerId, count: penalty });
            addLog(`› ${player.name} drew ${penalty} cards.`);
            player.unoState = 'safe';
            gameState.drawPenalty = 0;

            if (gameState.winnerOnHold.length > 0) {
                const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                if (!heldWinners.some(w => w.playerId === player.playerId)) {
                    handleEndOfRound(heldWinners);
                    return;
                } else {
                    gameState.winnerOnHold = [];
                }
            }

            advanceTurn();
        } else {
            const hasPlayableColorCard = player.hand.some(card =>
                card.color !== 'Black' && isMoveValid(card, topCard, gameState.activeColor, 0)
            );
            if (hasPlayableColorCard) {
                io.to(socket.id).emit('announce', 'You have a playable color card and must play it.');
                return;
            }

            if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} drew a card.`);
                if (isMoveValid(drawnCard, topCard, gameState.activeColor, 0)) {
                    if (drawnCard.color === 'Black') {
                        player.hand.push(drawnCard);
                        if (player.hand.length === 1) {
                            player.unoState = 'declared';
                            io.emit('unoCalled', { playerName: player.name });
                        }
                        const cardIndex = player.hand.length - 1;
                        io.to(socket.id).emit('drawnWildCard', { cardIndex, drawnCard });
                        return;
                    } else {
                        gameState.discardPile.unshift(drawnCard);
                        gameState.activeColor = drawnCard.color;
                        applyCardEffect(drawnCard);
                        io.to(socket.id).emit('announce', `You drew a playable card (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                        addLog(`...and it was a playable ${drawnCard.color} ${drawnCard.value}!`);
                        if (player.hand.length === 1) {
                            player.unoState = 'declared';
                            io.emit('unoCalled', { playerName: player.name });
                        }
                        if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) {
                            advanceTurn();
                        }
                        advanceTurn();
                    }
                } else {
                    player.hand.push(drawnCard);
                    player.unoState = 'safe';
                    advanceTurn();
                }
            } else {
                addLog(`Draw pile is empty! ${player.name} passes their turn.`);
                advanceTurn();
            }
        }
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('choosePlayDrawnWild', ({ play, cardIndex }) => {
    if (!gameState || gameState.isPaused) return; // *** RENAMED
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (play) {
        const player = gameState.players[playerIndex];
        if (player && player.hand.length === 2) {
            player.unoState = 'declared';
        }
        handleCardPlay(playerIndex, cardIndex);
    } else {
        const player = gameState.players[playerIndex];
        addLog(`› ${player.name} chose to keep the drawn Wild card.`);
        advanceTurn();
    }
    if (gameState && !gameState.roundOver) {
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('pickUntilChoice', ({ choice }) => {
      if (!gameState || gameState.isPaused) return; // *** RENAMED
      const player = gameState.players.find(p => p.socketId === socket.id);
      if (gameState.needsPickUntilChoice !== player.playerId) return;

      const numPlayers = gameState.players.length;
      const originalPlayerIndex = gameState.players.findIndex(p => p.socketId === socket.id);

      if (choice === 'discard-wilds') {
          addLog(`🌪️ Everyone else discards their Wild cards!`);
          const winners = [];
          gameState.players.forEach(p => {
              if (p.socketId !== socket.id) {
                  const originalHandSize = p.hand.length;
                  if (originalHandSize > 0) {
                      p.hand = p.hand.filter(card => card.color !== 'Black');
                      if (p.hand.length === 0) {
                          winners.push(p);
                      }
                      else if (p.hand.length === 1 && originalHandSize > 1) {
                          p.unoState = 'declared';
                          io.emit('unoCalled', { playerName: p.name });
                      }
                  }
              }
          });

          if (winners.length > 0) {
              const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
              handleEndOfRound([...winners, ...heldWinners]);
              return;
          }
          if (gameState.winnerOnHold.length > 0) {
              const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
              handleEndOfRound(heldWinners);
              return;
          }

          gameState.needsColorChoice = player.playerId;

      } else if (choice === 'pick-color') {
          let nextPlayerIndex = (originalPlayerIndex + gameState.playDirection + numPlayers) % numPlayers;
          let searchLimit = numPlayers; 
          while (gameState.players[nextPlayerIndex].status !== 'Active' && searchLimit > 0) {
              nextPlayerIndex = (nextPlayerIndex + gameState.playDirection + numPlayers) % numPlayers;
              searchLimit--;
          }
          if (gameState.players[nextPlayerIndex].status === 'Active' && gameState.players[nextPlayerIndex].playerId !== player.playerId) {
              gameState.pickUntilState = {
                  targetPlayerIndex: nextPlayerIndex,
                  active: false,
                  targetColor: null
              };
              gameState.needsColorChoice = player.playerId;
          } else {
              addLog('No other connected players to target. Turn continues.');
              gameState.needsColorChoice = player.playerId;
          }
      }
      gameState.needsPickUntilChoice = null;
      io.emit('updateGameState', gameState);
  });

  socket.on('swapHandsChoice', ({ targetPlayerId }) => {
    if (!gameState || gameState.isPaused) return; // *** RENAMED
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (gameState.needsSwapChoice !== choosingPlayer.playerId) return;

    const targetPlayer = gameState.players.find(p => p.playerId === targetPlayerId);
    if (choosingPlayer && targetPlayer) {
        io.emit('animateSwap', { p1_id: choosingPlayer.playerId, p2_id: targetPlayer.playerId });
        [choosingPlayer.hand, targetPlayer.hand] = [targetPlayer.hand, choosingPlayer.hand];
        addLog(`🤝 ${choosingPlayer.name} swapped hands with ${targetPlayer.name}!`);
    }
    gameState.needsSwapChoice = null;
    gameState.swapState = null;
    advanceTurn();
    io.emit('updateGameState', gameState);
  });

  socket.on('colorChosen', ({ color }) => {
    if (!gameState || gameState.isPaused) return; // *** RENAMED
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (gameState.needsColorChoice !== choosingPlayer.playerId) return;

    addLog(`🎨 ${choosingPlayer.name} chose the color ${color}.`);

    if (gameState.swapState) {
        gameState.activeColor = color;
        gameState.needsSwapChoice = gameState.swapState.choosingPlayerId;
    } else if (gameState.pickUntilState) {
        gameState.pickUntilState.active = true;
        gameState.pickUntilState.targetColor = color;
        gameState.activeColor = color;
        gameState.currentPlayerIndex = gameState.pickUntilState.targetPlayerIndex;
        const targetPlayer = gameState.players[gameState.pickUntilState.targetPlayerIndex];
        addLog(`› ${targetPlayer.name} must now pick until they find a ${color} card!`);
    } else {
        gameState.activeColor = color;
        const isDealerChoosingFirstCard = gameState.discardPile.length === 1 && gameState.players[gameState.dealerIndex].playerId === choosingPlayer.playerId;
        if (!isDealerChoosingFirstCard) {
            advanceTurn();
        }
    }
    gameState.needsColorChoice = null;
    io.emit('updateGameState', gameState);
  });

  socket.on('rearrangeHand', ({ newHand }) => {
    if (!gameState) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (player) {
        if (newHand.length === player.hand.length) {
            player.hand = newHand;
        }
    }
  });

  // *** START: NEW 'markPlayerAFK' HANDLER ***
  socket.on('markPlayerAFK', ({ playerIdToMark }) => {
    if (!gameState || gameState.isPaused) return; // Don't allow marking AFK if already paused

    const host = gameState.players.find(p => p.socketId === socket.id && p.isHost);
    const playerToMark = gameState.players.find(p => p.playerId === playerIdToMark);

    if (host && playerToMark && playerToMark.status === 'Active') {
        playerToMark.status = 'Disconnected';
        addLog(`Host ${host.name} marked ${playerToMark.name} as AFK. The game is paused.`);

        // Trigger pause
        gameState.isPaused = true;
        const pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
        
        // Update pause info for all disconnected players
        const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        gameState.pauseInfo = {
            pauseEndTime: pauseEndTime, // Set a new end time
            pausedForPlayerNames: allDisconnected.map(p => p.name)
        };
        
        // Start a removal timer for the marked player
        if (reconnectTimers[playerToMark.playerId]) {
            clearTimeout(reconnectTimers[playerToMark.playerId]);
        }
        reconnectTimers[playerToMark.playerId] = setTimeout(() => {
            handlePlayerRemoval(playerToMark.playerId);
        }, DISCONNECT_GRACE_PERIOD);

        // Notify the marked player
        io.to(playerToMark.socketId).emit('youWereMarkedAFK');
        io.emit('updateGameState', gameState);
    }
  });
  // *** END: NEW 'markPlayerAFK' HANDLER ***

  // *** START: NEW 'playerIsBack' HANDLER ***
  socket.on('playerIsBack', () => {
    if (!gameState) return;
    const player = gameState.players.find(p => p.socketId === socket.id);

    if (player && player.status === 'Disconnected') {
        player.status = 'Active';
        addLog(`Player ${player.name} is back!`);

        // Clear their removal timer
        if (reconnectTimers[player.playerId]) {
            clearTimeout(reconnectTimers[player.playerId]);
            delete reconnectTimers[player.playerId];
        }

        // Check if we can unpause
        const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (otherDisconnected.length === 0) {
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All players are back. Game resumed.");
        } else {
            // Update pause info
            gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
        }
        
        io.emit('updateGameState', gameState);
    }
  });
  // *** END: NEW 'playerIsBack' HANDLER ***


  // *** REFACTORED: 'disconnect' HANDLER ***
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    if (gameState) {
        const disconnectedPlayer = gameState.players.find(p => p.socketId === socket.id);
        
        if (disconnectedPlayer && disconnectedPlayer.status === 'Active') {
            disconnectedPlayer.status = 'Disconnected';
            addLog(`Player ${disconnectedPlayer.name} has disconnected. The game is paused.`);

            // Trigger pause
            gameState.isPaused = true;
            const pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
            
            // Update pause info for all disconnected players
            const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            gameState.pauseInfo = {
                pauseEndTime: pauseEndTime, // Set a new end time
                pausedForPlayerNames: allDisconnected.map(p => p.name)
            };

            // Start a removal timer for this player
            if (reconnectTimers[disconnectedPlayer.playerId]) {
                clearTimeout(reconnectTimers[disconnectedPlayer.playerId]);
            }
            reconnectTimers[disconnectedPlayer.playerId] = setTimeout(() => {
                handlePlayerRemoval(disconnectedPlayer.playerId);
            }, DISCONNECT_GRACE_PERIOD);

            io.emit('updateGameState', gameState);
        }
    } else {
        // Player was in lobby
        const playerInLobby = players.find(player => player.socketId === socket.id);
        if (playerInLobby) {
            players = players.filter(player => player.socketId !== socket.id);
            // Handle host leaving lobby
            if (playerInLobby.isHost && players.length > 0) {
                players[0].isHost = true;
            }
            io.emit('lobbyUpdate', players);
        }
    }
  });
  // *** END: REFACTORED 'disconnect' HANDLER ***
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ UNO Server is live and listening on port ${PORT}`);
});