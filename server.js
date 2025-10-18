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
let reconnectTimers = {};
const DISCONNECT_GRACE_PERIOD = 60000;

// --- GAME LOGIC FUNCTIONS ---

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
                    score += 100; break;
                case 'Draw Two':
                    score += 25; break;
                case 'Skip':
                case 'Reverse':
                    score += 20; break;
                default: // Wilds
                    score += 50; break;
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
        playerId: p.playerId, socketId: p.socketId, name: p.name, isHost: p.isHost,
        score: 0, hand: [], unoState: 'safe', scoresByRound: [], status: 'Active'
    }));
    return {
        players: gamePlayers, dealerIndex: -1, numCardsToDeal: 7,
        discardPile: [], drawPile: [], gameWinner: null, winnerOnHold: [],
        roundNumber: 0, isPaused: false,
        pauseInfo: { pauseEndTime: null, pausedForPlayerNames: [] },
        readyForNextRound: [], playDirection: 1 // Initialize playDirection
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
            player.hand = [];
        }
    });

    let topCard = roundDeck.shift();
    while (topCard.value === 'Wild Draw Four' || topCard.value === 'Wild Swap') {
        roundDeck.push(topCard);
        roundDeck = shuffleDeck(roundDeck);
        topCard = roundDeck.shift();
    }

    gs.discardPile = [{ card: topCard, playerName: 'Deck' }];
    gs.drawPile = roundDeck;
    gs.activeColor = topCard.color;
    // gs.playDirection = 1; // Direction persists between rounds
    gs.drawPenalty = 0;
    gs.needsColorChoice = null;
    gs.needsPickUntilChoice = null;
    gs.pickUntilState = null;
    gs.needsSwapChoice = null;
    gs.swapState = null;
    gs.roundOver = false;
    gs.needsDealChoice = null;
    gs.winnerOnHold = [];
    gs.isPaused = false;
    gs.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
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
                gs.playDirection *= -1; // Apply reverse effect immediately
                let tempIndex = gs.dealerIndex;
                do {
                    tempIndex = (tempIndex + gs.playDirection + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                firstPlayerIndex = tempIndex;
            } else { // 2-player reverse acts as a skip
                let tempIndex = firstPlayerIndex;
                do {
                    tempIndex = (tempIndex + gs.playDirection + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                firstPlayerIndex = tempIndex;
            }
        } else if (topCard.value === 'Skip') {
            let tempIndex = firstPlayerIndex;
            do {
                tempIndex = (tempIndex + gs.playDirection + numPlayers) % numPlayers;
            } while (gs.players[tempIndex].status !== 'Active');
            firstPlayerIndex = tempIndex;
        }
        if (topCard.value === 'Draw Two') {
            applyCardEffect(topCard); // Pass only the card
        }
    } else {
        gs.needsColorChoice = dealer.playerId;
        gs.discardPile[0].playerName = dealer.name;
        if (topCard.value === 'Wild Pick Until') {
            gs.needsPickUntilChoice = dealer.playerId;
        }
    }

    gs.currentPlayerIndex = firstPlayerIndex;
    return gs;
}


function isMoveValid(playedCard, topCard, activeColor, drawPenalty) {
    if (!topCard) return true; // Can play anything if discard is somehow empty (shouldn't happen)
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
        return;
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
    // No need for gameState here as playDirection and drawPenalty are directly on gs
    switch(playedCard.value) {
        case 'Reverse':
            if (gameState.players.filter(p=>p.status === 'Active').length > 2) {
                gameState.playDirection *= -1;
                addLog(`Direction reversed! Play is now ${gameState.playDirection === 1 ? 'clockwise' : 'counter-clockwise'}.`);
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
    if (!gameState || gameState.roundOver) return; // Added gameState check
    gameState.roundOver = true;
    gameState.readyForNextRound = [];
    const scoresForRound = [];

    gameState.players.forEach(p => {
        const roundScore = (p.status === 'Active' || p.status === 'Disconnected') ? calculateScore(p.hand) : 0;
        p.score += roundScore;
        p.scoresByRound.push((p.status === 'Active' || p.status === 'Disconnected') ? roundScore : '-');
        scoresForRound.push({ name: p.name, roundScore: roundScore, cumulativeScore: p.score });
    });

    const winnerNames = winners.map(w => w.name).join(' and ');
    addLog(`🏁 ${winnerNames} wins the round!`);

    io.emit('announceRoundWinner', { winnerNames });
    io.emit('roundOver', { winnerName: winnerNames, scores: scoresForRound, finalGameState: gameState });
}


function handleCardPlay(playerIndex, cardIndex) {
    if (!gameState || playerIndex !== gameState.currentPlayerIndex || gameState.roundOver || gameState.isPaused) return;
    const player = gameState.players[playerIndex];
    if (!player || !player.hand[cardIndex]) return;

    const playedCard = player.hand[cardIndex];
    const topDiscard = gameState.discardPile[0];
    const topCard = topDiscard ? topDiscard.card : null; // Handle potential empty discard pile initially
    const actionCardsThatDelayWin = ['Draw Two', 'Wild Draw Four', 'Wild Pick Until'];

    if (isMoveValid(playedCard, topCard, gameState.activeColor, gameState.drawPenalty)) {
        io.emit('animatePlay', { playerId: player.playerId, card: playedCard, cardIndex: cardIndex });
        player.hand.splice(cardIndex, 1);
        const cardName = `${playedCard.color !== 'Black' ? playedCard.color + ' ' : ''}${playedCard.value}`;
        addLog(`› ${player.name} played a ${cardName}.`);

        // Check for UNO miss *before* checking win condition
        if (player.hand.length === 1 && player.unoState !== 'declared') {
             if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
             if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
             player.unoState = 'safe'; // Reset state after penalty
             io.to(player.socketId).emit('announce', 'Penalty! You forgot to call UNO.');
             addLog(` penalty on ${player.name} for not calling UNO.`);
             io.emit('animateDraw', { playerId: player.playerId, count: 2 });
             // Since they drew, they cannot win this turn. Proceed.
        } else if (player.hand.length === 1 && player.unoState === 'declared') {
            // Safe to call UNO, state will be reset later or on win
             io.emit('unoCalled', { playerName: player.name });
             // Don't set unoState to safe here, let win check or next turn handle it
        } else if (player.hand.length > 1) {
            player.unoState = 'safe'; // Reset if hand size increased
        }

        // Now check for win condition *after* potential UNO penalty draw
        if (player.hand.length === 0) {
            if (actionCardsThatDelayWin.includes(playedCard.value)) {
                gameState.winnerOnHold.push(player.playerId);
                // Don't end round yet, let effect resolve
            } else {
                handleEndOfRound([player]);
                return; // Round is over
            }
        }

        // Handle successful UNO call state reset if not winning turn
        if (player.hand.length === 1 && player.unoState === 'declared') {
             player.unoState = 'safe'; // Reset after successful call and turn continues
        }


        gameState.discardPile.unshift({ card: playedCard, playerName: player.name });

        // Handle specific card actions *after* adding to discard pile
        if (playedCard.value === 'Wild Pick Until') {
            gameState.needsPickUntilChoice = player.playerId;
            // Don't advance turn, wait for choice
            return;
        } else if (playedCard.value === 'Wild Swap') {
            gameState.swapState = { choosingPlayerId: player.playerId };
            gameState.needsColorChoice = player.playerId; // Color choice needed first
            // Don't advance turn, wait for color/swap choice
            return;
        }

        // Apply effects of non-choice cards
        applyCardEffect(playedCard);

        // Determine next player *after* effects are applied
        let skipTurn = false;
        if (playedCard.value === 'Skip' || (playedCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) {
            skipTurn = true;
        }

        if (playedCard.color === 'Black') {
            gameState.needsColorChoice = player.playerId;
             // Don't advance turn yet if skip is also involved (rare), wait for color
            if (skipTurn) {
                // We need to advance *after* color is chosen
                gameState.skipNextTurnAfterColor = true; // Flag for colorChosen handler
            }
            // If just Wild/WildDraw4, wait for color, turn advances in colorChosen
        } else {
            gameState.activeColor = playedCard.color;
            if (skipTurn) {
                advanceTurn(); // Apply the skip immediately
            }
            advanceTurn(); // Advance to the actual next player
        }
    } else {
         // Invalid move attempted (client-side check failed or race condition)
         io.to(player.socketId).emit('announce', 'Invalid move!');
         // Optional: Send updateGameState to ensure client resyncs if needed
         // io.to(player.socketId).emit('updateGameState', gameState);
    }
}

function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const player = gameState.players.find(p => p.playerId === playerId);

    if (player && player.status === 'Disconnected') {
        player.status = 'Removed';
        addLog(`Player ${player.name} failed to reconnect and has been removed.`);
        if (reconnectTimers[playerId]) {
            clearTimeout(reconnectTimers[playerId]);
            delete reconnectTimers[playerId];
        }

        if (player.isHost) {
            const nextActivePlayer = gameState.players.find(p => p.status === 'Active');
            if (nextActivePlayer) {
                nextActivePlayer.isHost = true;
                addLog(`Host ${player.name} was removed. ${nextActivePlayer.name} is the new host.`);
            } else {
                addLog(`Host ${player.name} was removed. No active players left.`);
            }
        }

        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2) {
            addLog('Less than 2 active players remaining. Game over.');
            io.emit('finalGameOver', gameState);
            gameState = null;
            reconnectTimers = {};
            return;
        }

        const remainingDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (remainingDisconnected.length === 0 && gameState.isPaused) { // Check if paused before resuming
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All disconnected players have been handled. Game resumed.");
        } else if (gameState.isPaused) {
            gameState.pauseInfo.pausedForPlayerNames = remainingDisconnected.map(p => p.name);
             // Keep pauseEndTime from the *first* disconnect that caused the pause
        }

        // If it was the removed player's turn, advance immediately
        if (!gameState.roundOver && gameState.players[gameState.currentPlayerIndex]?.playerId === playerId) {
            addLog(`It was ${player.name}'s turn. Advancing to next active player.`);
            advanceTurn();
        }

        io.emit('updateGameState', gameState);

    } else if (reconnectTimers[playerId]) {
        clearTimeout(reconnectTimers[playerId]);
        delete reconnectTimers[playerId];
    }
}

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinGame', ({ playerName, playerId }) => {
    if (gameState) {
        let playerToRejoin = null;
        if (playerId) {
            playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status !== 'Active');
        }

        // --- Hybrid Reconnection ---
        if (!playerToRejoin) { /* ... (logic unchanged) ... */ }
        // --- End Hybrid ---

        if (playerToRejoin) {
            console.log(`${playerName} is rejoining as ${playerToRejoin.name}.`);
            playerToRejoin.status = 'Active';
            playerToRejoin.socketId = socket.id;
            playerToRejoin.name = playerName;

            if (reconnectTimers[playerToRejoin.playerId]) {
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];
            }
            addLog(`Player ${playerToRejoin.name} has reconnected!`);

            const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (otherDisconnected.length === 0 && gameState.isPaused) { // Check if paused
                gameState.isPaused = false;
                gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
                addLog("All players reconnected/returned. Game resumed.");
            } else if (gameState.isPaused) {
                gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
                 // Keep existing pauseEndTime
            }

            socket.emit('joinSuccess', { playerId: playerToRejoin.playerId, lobby: gameState.players });
            io.emit('updateGameState', gameState); // Send update to everyone
            return;
        } else {
            socket.emit('announce', 'Game is in progress. Cannot join now.');
            return;
        }
    }

    // --- Lobby Join Logic ---
    let pId = playerId || Math.random().toString(36).substr(2, 9);
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

  socket.on('rejoinGame', (playerId) => { // Mostly redundant now but keep for safety
    if (!gameState || !playerId) return;
    const playerToRejoin = gameState.players.find(p => p.playerId === playerId);
    if (playerToRejoin && playerToRejoin.status !== 'Active') {
        playerToRejoin.status = 'Active';
        playerToRejoin.socketId = socket.id;
        if (reconnectTimers[playerToRejoin.playerId]) { /* ... (clear timer) ... */ }
        addLog(`Player ${playerToRejoin.name} has reconnected!`);
        const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (otherDisconnected.length === 0 && gameState.isPaused) { /* ... (unpause) ... */ }
        else if (gameState.isPaused) { /* ... (update pause names) ... */ }
        io.emit('updateGameState', gameState);
    } else if (playerToRejoin && playerToRejoin.status === 'Active') {
        playerToRejoin.socketId = socket.id; // Update socket ID if rejoining while active
        socket.emit('updateGameState', gameState); // Send state only to rejoining client
    }
  });

  socket.on('kickPlayer', ({ playerIdToKick }) => {
    if (gameState) return;
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host) {
        const playerToKick = players.find(p => p.playerId === playerIdToKick);
        if (playerToKick) {
            players = players.filter(player => player.playerId !== playerIdToKick);
            io.emit('lobbyUpdate', players);
             // Notify kicked player's socket directly (optional but good UX)
            const kickedSocket = io.sockets.sockets.get(playerToKick.socketId);
            if (kickedSocket) {
                kickedSocket.emit('announce', 'You were kicked by the host.');
                // Force disconnect after a short delay
                setTimeout(() => kickedSocket.disconnect(true), 1000);
            }
        }
    }
  });

  socket.on('startGame', () => {
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host && players.length >= 2 && !gameState) { // Prevent starting if game exists
      gameState = setupGame(players);
      // First dealer is random or host? Let's make it host for simplicity first time.
      const hostIndex = gameState.players.findIndex(p => p.isHost);
      gameState.dealerIndex = hostIndex !== -1 ? hostIndex : 0;
      gameState.needsDealChoice = gameState.players[gameState.dealerIndex].playerId;
      io.emit('updateGameState', gameState);
      // Clear lobby array after game starts
       players = [];
    }
  });

  function checkAndStartNextRound() {
    if (!gameState || !gameState.roundOver) return; // Only proceed if round is over
    const host = gameState.players.find(p => p.isHost && p.status !== 'Removed'); // Host must not be removed
    const activePlayers = gameState.players.filter(p => p.status === 'Active');

    if (!host) return; // Need an active host

    const hostIsReady = gameState.readyForNextRound.includes(host.playerId);
    // All *active* players must be ready
    const allActivePlayersReady = activePlayers.every(p => gameState.readyForNextRound.includes(p.playerId));

    if (hostIsReady && allActivePlayersReady) {
        // Determine next dealer, skipping removed/disconnected
        let nextDealerIndex = gameState.dealerIndex;
        do {
            nextDealerIndex = (nextDealerIndex + 1) % gameState.players.length;
        } while (gameState.players[nextDealerIndex].status === 'Removed');

        gameState.dealerIndex = nextDealerIndex;
        const dealer = gameState.players[nextDealerIndex];

        // If the chosen dealer is disconnected, skip deal choice and start round
        if (dealer.status === 'Disconnected') {
             addLog(`${dealer.name} is the dealer but is disconnected. Dealing default cards.`);
             gameState.numCardsToDeal = 7; // Default
             gameState = startNewRound(gameState);
             io.emit('updateGameState', gameState);
        } else {
            // Active dealer gets to choose
            gameState.needsDealChoice = dealer.playerId;
            // Send update, but round hasn't technically started (cards not dealt)
            // Reset roundOver flag here before asking dealer
            gameState.roundOver = false;
            io.emit('updateGameState', gameState);
        }
    }
  }


  socket.on('playerReadyForNextRound', () => {
      if (!gameState || !gameState.roundOver) return; // Can only ready up when round is over
      const player = gameState.players.find(p => p.socketId === socket.id && p.status === 'Active'); // Only active players can ready
      if (player && !gameState.readyForNextRound.includes(player.playerId)) {
          gameState.readyForNextRound.push(player.playerId);
          addLog(`${player.name} is ready for the next round.`);
          checkAndStartNextRound(); // Check if everyone is now ready
          io.emit('updateGameState', gameState); // Update readiness status for others
      }
  });


  socket.on('dealChoice', ({ numCards }) => {
    if (!gameState || gameState.isPaused) return;
    const dealingPlayer = gameState.players.find(p => p.socketId === socket.id);
      if (gameState && gameState.needsDealChoice === dealingPlayer?.playerId) {
          const numToDeal = Math.max(1, Math.min(13, parseInt(numCards) || 7));
          gameState.numCardsToDeal = numToDeal;
          // Now officially start the round
          gameState = startNewRound(gameState);
          io.emit('updateGameState', gameState);
      }
  });

  socket.on('endGame', () => {
      if(gameState) {
          const player = gameState.players.find(p => p.socketId === socket.id);
          if (player && player.isHost) {
              io.emit('finalGameOver', gameState);
              addLog(`The game has been ended by the host ${player.name}.`);
              gameState = null;
              players = []; // Reset lobby
              reconnectTimers = {}; // Clear timers
          }
      }
  });

  socket.on('playCard', ({ cardIndex }) => {
    if (!gameState || gameState.isPaused) return;
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
        handleCardPlay(playerIndex, cardIndex);
        // Only update if round didn't end
        if (gameState && !gameState.roundOver) {
             io.emit('updateGameState', gameState);
        }
    }
  });

  socket.on('callUno', () => {
    if (!gameState || gameState.isPaused) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    // Player must have exactly 2 cards *before* playing one to declare UNO
    if (player && player.hand.length === 2 && gameState.players[gameState.currentPlayerIndex]?.playerId === player.playerId) {
        player.unoState = 'declared';
        addLog(`📣 ${player.name} is ready to call UNO!`);
        // Send update so button highlights immediately (optional)
        // io.emit('updateGameState', gameState);
    } else if (player && player.hand.length !== 2) {
         io.to(socket.id).emit('announce', 'You can only call UNO when you have 2 cards.');
    }
  });


  socket.on('drawCard', () => {
    if (!gameState || gameState.roundOver || gameState.isPaused) return;
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);

    if (playerIndex === gameState.currentPlayerIndex) {
        const player = gameState.players[playerIndex];
        const topDiscard = gameState.discardPile[0];
        const topCard = topDiscard ? topDiscard.card : null;

        // Reset UNO state if drawing (unless it's a penalty)
        if (gameState.drawPenalty === 0) player.unoState = 'safe';


        if (gameState.pickUntilState?.active && gameState.pickUntilState.targetPlayerIndex === playerIndex) {
            /* ... (logic unchanged for pick until) ... */
             if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                player.hand.push(drawnCard);
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} is picking for a ${gameState.pickUntilState.targetColor}...`);
                if (drawnCard.color === gameState.pickUntilState.targetColor) {
                    player.hand.splice(player.hand.findIndex(c => c === drawnCard), 1);
                    gameState.discardPile.unshift({ card: drawnCard, playerName: player.name });
                    gameState.activeColor = drawnCard.color;
                    io.to(socket.id).emit('announce', `You drew the target color (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                    addLog(`› ${player.name} found and played a ${drawnCard.color} card.`);
                    applyCardEffect(drawnCard);
                    if (player.hand.length === 0) { /* ... (handle win) ... */ }
                    if (gameState.winnerOnHold.length > 0) { /* ... (handle win) ... */ }
                    gameState.pickUntilState = null;
                    if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) { advanceTurn(); }
                    advanceTurn();
                } // else, keep drawing next turn or via button click
            } else {
                 addLog(`Draw pile empty! ${player.name} cannot pick for color.`);
                 gameState.pickUntilState = null; // End the state
                 advanceTurn(); // Move to next player
            }
        } else if (gameState.drawPenalty > 0) {
            /* ... (logic unchanged for draw penalty) ... */
             const penalty = gameState.drawPenalty;
             let drawnCount = 0;
            for (let i = 0; i < penalty; i++) {
                if (gameState.drawPile.length > 0) {
                     player.hand.push(gameState.drawPile.shift());
                     drawnCount++;
                } else { break; } // Stop if draw pile runs out
            }
            if(drawnCount > 0) io.emit('animateDraw', { playerId: player.playerId, count: drawnCount });
            addLog(`› ${player.name} drew ${drawnCount} card(s).`);
            gameState.drawPenalty = 0; // Penalty served
            if (gameState.winnerOnHold.length > 0) { /* ... (check held winners) ... */ }
            advanceTurn();
        } else { // Normal draw
            /* ... (logic largely unchanged, check topCard exists) ... */
             const hasPlayableColorCard = player.hand.some(card =>
                card.color !== 'Black' && isMoveValid(card, topCard, gameState.activeColor, 0)
            );
            if (hasPlayableColorCard) {
                io.to(socket.id).emit('announce', 'You have a playable color card and must play it.');
                return; // Don't draw if playable exists
            }

            if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} drew a card.`);
                if (isMoveValid(drawnCard, topCard, gameState.activeColor, 0)) {
                    if (drawnCard.color === 'Black') {
                        player.hand.push(drawnCard);
                        // Check if drawing this makes UNO possible
                        if (player.hand.length === 2) {
                             // Don't auto-declare, but they *can* now
                        }
                        const cardIndex = player.hand.findIndex(c => c === drawnCard); // Find index in current hand
                        io.to(socket.id).emit('drawnWildCard', { cardIndex, drawnCard });
                        return; // Wait for player choice
                    } else {
                        gameState.discardPile.unshift({ card: drawnCard, playerName: player.name });
                        gameState.activeColor = drawnCard.color;
                        applyCardEffect(drawnCard);
                        io.to(socket.id).emit('announce', `You drew a playable card (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                        addLog(`...and it was a playable ${drawnCard.color} ${drawnCard.value}!`);
                        // No need to check UNO state here as card was played for them
                        if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && gameState.players.filter(p=>p.status === 'Active').length === 2)) { advanceTurn(); }
                        advanceTurn();
                    }
                } else { // Drawn card is not playable
                    player.hand.push(drawnCard);
                    advanceTurn();
                }
            } else { // Draw pile empty
                addLog(`Draw pile is empty! ${player.name} passes their turn.`);
                advanceTurn();
            }
        }
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('choosePlayDrawnWild', ({ play, cardIndex }) => {
    if (!gameState || gameState.isPaused) return;
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
     // Validate cardIndex
     const player = gameState.players[playerIndex];
     if (!player || cardIndex < 0 || cardIndex >= player.hand.length) {
          console.error(`Invalid cardIndex ${cardIndex} for player ${player?.name}`);
          return;
     }

    if (play) {
        // Player needs to potentially declare UNO *before* playing the wild
        if (player.hand.length === 2) {
            // Player *should* have clicked UNO button client-side if they intended to
            // Server just handles the play logic based on current unoState
            // unoState check happens within handleCardPlay
        }
        handleCardPlay(playerIndex, cardIndex);
    } else {
        addLog(`› ${player.name} chose to keep the drawn Wild card.`);
        advanceTurn();
    }
    // Only update if round didn't end
    if (gameState && !gameState.roundOver) {
        io.emit('updateGameState', gameState);
    }
  });

  // *** MODIFIED: pickUntilChoice for discard wilds ***
  socket.on('pickUntilChoice', ({ choice }) => {
      if (!gameState || gameState.isPaused) return;
      const player = gameState.players.find(p => p.socketId === socket.id);
      if (!player || gameState.needsPickUntilChoice !== player.playerId) return;

      const numPlayers = gameState.players.length;
      const originalPlayerIndex = gameState.players.findIndex(p => p.socketId === socket.id);

      if (choice === 'discard-wilds') {
          addLog(`🌪️ ${player.name} forces everyone else to discard Wild cards!`);
          const winners = [];
          let discardedWildsInfo = []; // *** Store info for modal ***

          gameState.players.forEach(p => {
              if (p.socketId !== socket.id && p.status === 'Active') { // Only affect active opponents
                  const originalHandSize = p.hand.length;
                  if (originalHandSize > 0) {
                      const wildsInHand = p.hand.filter(card => card.color === 'Black'); // Find wilds first

                      if (wildsInHand.length > 0) {
                          addLog(` ${p.name} discards ${wildsInHand.length} Wild card(s).`);
                          // *** Store info for modal ***
                          discardedWildsInfo.push({ playerName: p.name, cards: [...wildsInHand] });
                          // *** Add wilds to main discard pile history ***
                          wildsInHand.forEach(wildCard => gameState.discardPile.unshift({ card: wildCard, playerName: p.name }));

                          // Now filter the hand
                          p.hand = p.hand.filter(card => card.color !== 'Black');

                          if (p.hand.length === 0) {
                              winners.push(p); // They might win by discarding wilds
                          } else if (p.hand.length === 1 && originalHandSize > 1) {
                              // If discarding wilds resulted in 1 card, they must call UNO next turn
                              p.unoState = 'unsafe'; // Mark as potentially needing penalty
                              // Don't auto-call UNO for them here
                          }
                      }
                  }
              }
          });

           // *** Emit event for the modal ***
          if (discardedWildsInfo.length > 0) {
                io.emit('showDiscardedWildsModal', discardedWildsInfo);
          }


          if (winners.length > 0) {
              const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
              handleEndOfRound([...winners, ...heldWinners]);
              return; // Round over
          }
          if (gameState.winnerOnHold.length > 0) { // Check if original player wins now
              const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
              handleEndOfRound(heldWinners);
              return; // Round over
          }

          gameState.needsColorChoice = player.playerId; // Still need to choose color

      } else if (choice === 'pick-color') {
          /* ... (logic unchanged) ... */
           let nextPlayerIndex = originalPlayerIndex; // Start search from current player
           let searchLimit = numPlayers;
           let nextActivePlayerFound = false;
           do {
                 nextPlayerIndex = (nextPlayerIndex + gameState.playDirection + numPlayers) % numPlayers;
                 if (gameState.players[nextPlayerIndex].status === 'Active') {
                      nextActivePlayerFound = true;
                      break;
                 }
                 searchLimit--;
           } while (searchLimit > 0 && nextPlayerIndex !== originalPlayerIndex); // Prevent infinite loop if only one player

          if (nextActivePlayerFound && gameState.players[nextPlayerIndex].playerId !== player.playerId) {
              gameState.pickUntilState = {
                  targetPlayerIndex: nextPlayerIndex,
                  active: false, // Becomes active after color choice
                  targetColor: null
              };
              gameState.needsColorChoice = player.playerId;
          } else {
              addLog('No other active players to target with Pick Until. Choosing color.');
              gameState.needsColorChoice = player.playerId; // Just choose color
          }
      }
      gameState.needsPickUntilChoice = null;
      io.emit('updateGameState', gameState);
  });


  socket.on('swapHandsChoice', ({ targetPlayerId }) => {
    if (!gameState || gameState.isPaused) return;
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (!choosingPlayer || gameState.needsSwapChoice !== choosingPlayer.playerId) return;

    const targetPlayer = gameState.players.find(p => p.playerId === targetPlayerId && p.status === 'Active'); // Target must be active
    if (targetPlayer) {
        io.emit('animateSwap', { p1_id: choosingPlayer.playerId, p2_id: targetPlayer.playerId });
        // Swap hands
        [choosingPlayer.hand, targetPlayer.hand] = [targetPlayer.hand, choosingPlayer.hand];
        // Reset UNO state for both after swap
        choosingPlayer.unoState = 'safe';
        targetPlayer.unoState = 'safe';
        addLog(`🤝 ${choosingPlayer.name} swapped hands with ${targetPlayer.name}!`);
    } else {
        addLog(`${choosingPlayer.name} tried to swap with an invalid target.`);
        // Don't advance turn, let them choose color maybe? Or just advance?
        // Let's advance to prevent getting stuck.
    }
    gameState.needsSwapChoice = null;
    gameState.swapState = null; // Clear swap state fully
    advanceTurn(); // Advance turn after swap attempt
    io.emit('updateGameState', gameState);
  });

  socket.on('colorChosen', ({ color }) => {
    if (!gameState || gameState.isPaused) return;
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (!choosingPlayer || gameState.needsColorChoice !== choosingPlayer.playerId) return;

    addLog(`🎨 ${choosingPlayer.name} chose the color ${color}.`);
    gameState.activeColor = color;
    gameState.needsColorChoice = null; // Color choice fulfilled

    let advance = true; // Assume turn advances unless specific state prevents it

    if (gameState.swapState) {
        // Color chosen, now needs swap target choice
        gameState.needsSwapChoice = gameState.swapState.choosingPlayerId;
        advance = false; // Don't advance, wait for swap choice
    } else if (gameState.pickUntilState) {
        // Color chosen, now activate pick until state for target
        gameState.pickUntilState.active = true;
        gameState.pickUntilState.targetColor = color;
        gameState.currentPlayerIndex = gameState.pickUntilState.targetPlayerIndex; // Target player's turn now
        const targetPlayer = gameState.players[gameState.pickUntilState.targetPlayerIndex];
        addLog(`› ${targetPlayer.name} must now pick until they find a ${color} card!`);
        advance = false; // Turn has been explicitly set
    } else {
        // Standard Wild or Wild Draw 4 color choice
        const isDealerChoosingFirstCard = gameState.discardPile.length === 1 && gameState.discardPile[0].card.color === 'Black' && gameState.players[gameState.dealerIndex].playerId === choosingPlayer.playerId;
        if (isDealerChoosingFirstCard) {
            advance = false; // Dealer choosing color for opening card doesn't advance turn
        }
        // Check if a skip was pending after this color choice
        if (gameState.skipNextTurnAfterColor) {
             advanceTurn(); // Apply the skip now
             gameState.skipNextTurnAfterColor = false; // Clear the flag
             advance = true; // Ensure the main advance happens too
        }

    }

    if (advance) {
        advanceTurn();
    }
    io.emit('updateGameState', gameState);
  });


  socket.on('rearrangeHand', ({ newHand }) => {
    if (!gameState) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (player) {
         // Basic validation: Check if card counts match
        if (newHand && Array.isArray(newHand) && newHand.length === player.hand.length) {
            // More robust validation could check if all cards in newHand exist in old hand
             player.hand = newHand;
             // No need to broadcast, only affects this player's view
             // Optional: send confirmation back? io.to(socket.id).emit(...)
        } else {
             console.warn(`Player ${player.name} sent invalid rearrangeHand data.`);
        }
    }
  });

  socket.on('markPlayerAFK', ({ playerIdToMark }) => {
    if (!gameState || gameState.isPaused) return;

    const host = gameState.players.find(p => p.socketId === socket.id && p.isHost);
    const playerToMark = gameState.players.find(p => p.playerId === playerIdToMark);

    if (host && playerToMark && playerToMark.status === 'Active') {
        playerToMark.status = 'Disconnected';
        addLog(`Host ${host.name} marked ${playerToMark.name} as AFK. The game is paused.`);

        const wasAlreadyPaused = gameState.isPaused;
        gameState.isPaused = true;
        const now = Date.now();
        // Only set a *new* end time if the game wasn't already paused
        const pauseEndTime = wasAlreadyPaused && gameState.pauseInfo.pauseEndTime ? gameState.pauseInfo.pauseEndTime : now + DISCONNECT_GRACE_PERIOD;

        const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        gameState.pauseInfo = {
            pauseEndTime: pauseEndTime,
            pausedForPlayerNames: allDisconnected.map(p => p.name)
        };

        if (!reconnectTimers[playerToMark.playerId]) { // Avoid duplicate timers
            reconnectTimers[playerToMark.playerId] = setTimeout(() => {
                handlePlayerRemoval(playerToMark.playerId);
            }, DISCONNECT_GRACE_PERIOD);
        }

        io.to(playerToMark.socketId).emit('youWereMarkedAFK');
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('playerIsBack', () => {
    if (!gameState) return;
    const player = gameState.players.find(p => p.socketId === socket.id);

    if (player && player.status === 'Disconnected') {
        player.status = 'Active';
        addLog(`Player ${player.name} is back!`);
        if (reconnectTimers[player.playerId]) {
            clearTimeout(reconnectTimers[player.playerId]);
            delete reconnectTimers[player.playerId];
        }

        const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (otherDisconnected.length === 0 && gameState.isPaused) { // Check if paused
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All players are back. Game resumed.");
        } else if (gameState.isPaused) {
            gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
             // Keep existing pauseEndTime
        }

        io.emit('updateGameState', gameState);
    }
  });


  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    if (gameState) {
        const disconnectedPlayer = gameState.players.find(p => p.socketId === socket.id);

        if (disconnectedPlayer && disconnectedPlayer.status === 'Active') {
            disconnectedPlayer.status = 'Disconnected';
            addLog(`Player ${disconnectedPlayer.name} has disconnected. The game is paused.`);

            const wasAlreadyPaused = gameState.isPaused;
            gameState.isPaused = true;
            const now = Date.now();
            const pauseEndTime = wasAlreadyPaused && gameState.pauseInfo.pauseEndTime ? gameState.pauseInfo.pauseEndTime : now + DISCONNECT_GRACE_PERIOD;


            const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            gameState.pauseInfo = {
                pauseEndTime: pauseEndTime,
                pausedForPlayerNames: allDisconnected.map(p => p.name)
            };

            if (!reconnectTimers[disconnectedPlayer.playerId]) { // Avoid duplicate timers
                 reconnectTimers[disconnectedPlayer.playerId] = setTimeout(() => {
                    handlePlayerRemoval(disconnectedPlayer.playerId);
                }, DISCONNECT_GRACE_PERIOD);
            }

            io.emit('updateGameState', gameState);
        }
    } else { // Player in lobby
        const playerIndex = players.findIndex(player => player.socketId === socket.id);
        if (playerIndex !== -1) {
             const wasHost = players[playerIndex].isHost;
             players.splice(playerIndex, 1); // Remove player
             // Handle host leaving lobby
             if (wasHost && players.length > 0 && !players.some(p => p.isHost)) {
                players[0].isHost = true; // Assign host to the next player
             }
             io.emit('lobbyUpdate', players); // Update lobby for everyone
        }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ UNO Server is live and listening on port ${PORT}`);
});