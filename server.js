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

// --- GAME LOGIC FUNCTIONS (The Server's Brain) ---

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
                case 'Wild Swap': score += 100; break;
                case 'Draw Two': score += 25; break;
                case 'Skip': case 'Reverse': score += 20; break;
                default: score += 50; break; // Catches all other Wild cards
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
        status: 'Active'
    }));
    return {
        phase: 'Lobby', // *** NEW: Initial phase ***
        players: gamePlayers,
        dealerIndex: -1,
        numCardsToDeal: 7,
        discardPile: [],
        drawPile: [],
        gameWinner: null,
        winnerOnHold: [],
        roundNumber: 0,
        isPaused: false,
        pauseInfo: { pauseEndTime: null, pausedForPlayerNames: [] },
        readyForNextRound: [],
        // --- State-specific data (replaces needs... flags) ---
        activeColor: null,
        playDirection: 1,
        drawPenalty: 0,
        currentPlayerIndex: 0,
        playerChoosingActionId: null, // Stores ID for Color, PickUntil, Swap, Deal choices
        pickUntilState: null, // { targetPlayerIndex, active, targetColor }
        swapState: null, // { choosingPlayerId, targetPlayerId } // Simplified
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
    gs.playDirection = 1;
    gs.drawPenalty = 0;
    gs.pickUntilState = null;
    gs.swapState = null;
    gs.winnerOnHold = [];
    gs.isPaused = false;
    gs.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
    gs.readyForNextRound = [];
    gs.playerChoosingActionId = null; // Reset action chooser

    const dealer = gs.players[gs.dealerIndex];
    addLog(`Round ${gs.roundNumber} begins. ${dealer.name} deals ${gs.numCardsToDeal} cards.`);

    let firstPlayerIndex = (gs.dealerIndex + 1) % numPlayers;
    while (gs.players[firstPlayerIndex].status !== 'Active') {
        firstPlayerIndex = (firstPlayerIndex + 1) % numPlayers;
    }
    gs.currentPlayerIndex = firstPlayerIndex; // Set initial player

    // Apply immediate effects of the first card
    if (topCard.color !== 'Black') {
        const connectedPlayersCount = gs.players.filter(p => p.status === 'Active').length;
        if (topCard.value === 'Reverse') {
            if (connectedPlayersCount > 2) {
                gs.playDirection = -1;
                // Reverse effectively makes the dealer the next player in >2 setup
                let tempIndex = gs.dealerIndex;
                 do {
                    tempIndex = (tempIndex - 1 + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                gs.currentPlayerIndex = tempIndex;

            } else { // 2-player reverse acts as a skip
                 let tempIndex = firstPlayerIndex;
                do {
                    tempIndex = (tempIndex + 1 + numPlayers) % numPlayers;
                } while (gs.players[tempIndex].status !== 'Active');
                gs.currentPlayerIndex = tempIndex;
            }
        } else if (topCard.value === 'Skip') {
            let tempIndex = firstPlayerIndex;
            do {
                tempIndex = (tempIndex + 1 + numPlayers) % numPlayers;
            } while (gs.players[tempIndex].status !== 'Active');
            gs.currentPlayerIndex = tempIndex;
        }
        if (topCard.value === 'Draw Two') {
            applyCardEffect(topCard); // Adds penalty, turn advances normally after
        }
        gs.phase = 'Playing'; // *** NEW: Start playing ***
    } else { // Top card is Wild
        gs.discardPile[0].playerName = dealer.name;
        gs.playerChoosingActionId = dealer.playerId; // Dealer chooses color
        if (topCard.value === 'Wild Pick Until') {
             gs.phase = 'ChoosingPickUntilAction'; // *** NEW: Go to Pick Until choice ***
        } else {
             gs.phase = 'ChoosingColor'; // *** NEW: Go directly to Color choice ***
        }
    }
    return gs;
}

function isMoveValid(playedCard, topCard, activeColor, drawPenalty) {
    if (drawPenalty > 0) return playedCard.value === topCard.value;
    if (playedCard.color === 'Black') return true;
    return playedCard.color === activeColor || playedCard.value === topCard.value;
}

function advanceTurn() {
    // Check phase? No, advanceTurn is called *after* phase is confirmed as 'Playing' or similar.
    if (!gameState) return; // Added safety check

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
    switch(playedCard.value) {
        case 'Reverse':
            if (gameState.players.filter(p=>p.status === 'Active').length > 2) {
                gameState.playDirection *= -1;
            }
            // Skip effect for 2 players handled in handleCardPlay/drawCard by calling advanceTurn twice
            break;
        case 'Draw Two':
        case 'Wild Draw Four':
            const penalty = (playedCard.value === 'Draw Two') ? 2 : 4;
            gameState.drawPenalty += penalty;
            break;
        // Skip is handled by calling advanceTurn twice
    }
}

function handleEndOfRound(winners) {
    if (gameState.phase === 'RoundOver' || gameState.phase === 'GameOver') return; // Prevent double trigger
    gameState.phase = 'RoundOver'; // *** NEW: Set phase ***
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
    io.emit('roundOver', { // Keep this event name for client compatibility for now
        winnerName: winnerNames,
        scores: scoresForRound,
        finalGameState: gameState // Send state with updated phase
    });
}


function handleCardPlay(playerIndex, cardIndex) {
    // *** NEW: Check phase ***
    if (!gameState || gameState.phase !== 'Playing' || playerIndex !== gameState.currentPlayerIndex || gameState.isPaused) return;

    const player = gameState.players[playerIndex];
    if (!player || !player.hand[cardIndex]) return;

    const playedCard = player.hand[cardIndex];
    const topCard = gameState.discardPile[0].card;
    const actionCardsThatDelayWin = ['Draw Two', 'Wild Draw Four', 'Wild Pick Until']; // Wild Swap doesn't delay win immediately

    if (isMoveValid(playedCard, topCard, gameState.activeColor, gameState.drawPenalty)) {
        io.emit('animatePlay', { playerId: player.playerId, card: playedCard, cardIndex: cardIndex });
        player.hand.splice(cardIndex, 1);
        const cardName = `${playedCard.color !== 'Black' ? playedCard.color + ' ' : ''}${playedCard.value}`;
        addLog(`› ${player.name} played a ${cardName}.`);

        // Check for UNO state penalty BEFORE checking for win
        if (player.hand.length === 1 && player.unoState !== 'declared') {
            if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            player.unoState = 'safe';
            io.to(player.socketId).emit('announce', 'Penalty! You forgot to call UNO.');
            addLog(` penalty on ${player.name} for not calling UNO.`);
            io.emit('animateDraw', { playerId: player.playerId, count: 2 });
        } else if (player.hand.length === 1 && player.unoState === 'declared') {
            io.emit('unoCalled', { playerName: player.name });
            player.unoState = 'safe'; // Reset after successful call
        } else if (player.hand.length > 1) {
             player.unoState = 'safe'; // Reset if hand size increases
        }


        // Check for win condition
        if (player.hand.length === 0) {
            if (actionCardsThatDelayWin.includes(playedCard.value)) {
                gameState.winnerOnHold.push(player.playerId);
                // Continue processing card effect, phase will change based on card
            } else {
                handleEndOfRound([player]); // This sets phase = 'RoundOver'
                return; // Round is over, stop processing
            }
        }

        gameState.discardPile.unshift({ card: playedCard, playerName: player.name });

        // Change phase based on card played
        if (playedCard.color === 'Black') {
            gameState.playerChoosingActionId = player.playerId; // Store who is choosing
            switch (playedCard.value) {
                case 'Wild Pick Until':
                    gameState.phase = 'ChoosingPickUntilAction'; // *** NEW: Set phase ***
                    break;
                case 'Wild Swap':
                    gameState.phase = 'ChoosingColor'; // *** NEW: Choose color first ***
                    gameState.swapState = { choosingPlayerId: player.playerId }; // Store swap intent
                    break;
                default: // Wild, Wild Draw Four
                    gameState.phase = 'ChoosingColor'; // *** NEW: Set phase ***
                    break;
            }
             applyCardEffect(playedCard); // Apply penalty if WD4, does nothing for others here
        } else {
            // Regular card played
            gameState.activeColor = playedCard.color;
            applyCardEffect(playedCard); // Apply D2, Reverse (direction), Skip (handled below)

            // Determine next player (Skip/Reverse might modify this)
            const numActivePlayers = gameState.players.filter(p => p.status === 'Active').length;
            if (playedCard.value === 'Skip' || (playedCard.value === 'Reverse' && numActivePlayers === 2)) {
                 addLog(`› ${player.name}'s ${playedCard.value} skips the next player.`);
                 advanceTurn(); // First advance moves to the skipped player
            }
            advanceTurn(); // Second (or only) advance moves to the actual next player
            gameState.phase = 'Playing'; // *** Ensure phase stays 'Playing' ***
        }
    }
     // No else needed - if move is invalid, nothing happens server-side
}

function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const player = gameState.players.find(p => p.playerId === playerId);

    if (player && player.status === 'Disconnected') {
        player.status = 'Removed';
        addLog(`Player ${player.name} failed to reconnect and has been removed.`);
        if (reconnectTimers[playerId]) { clearTimeout(reconnectTimers[playerId]); delete reconnectTimers[playerId]; }

        if (player.isHost) {
            const nextActivePlayer = gameState.players.find(p => p.status === 'Active');
            if (nextActivePlayer) { nextActivePlayer.isHost = true; addLog(`Host ${player.name} was removed. ${nextActivePlayer.name} is the new host.`); }
            else { addLog(`Host ${player.name} was removed. No active players left.`); }
        }

        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2 && gameState.phase !== 'GameOver') { // Check if game already over
            addLog('Less than 2 active players remaining. Game over.');
             gameState.phase = 'GameOver'; // *** NEW: Set phase ***
            io.emit('finalGameOver', gameState);
            gameState = null;
            reconnectTimers = {};
            return;
        }

        const remainingDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (remainingDisconnected.length === 0 && gameState.isPaused) { // Only unpause if it WAS paused
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All disconnected players have been handled. Game resumed.");
        } else if (gameState.isPaused) { // Update pause info if still paused
            gameState.pauseInfo.pausedForPlayerNames = remainingDisconnected.map(p => p.name);
        }

        // Advance turn ONLY if it was the removed player's turn AND the game is in a turn-based phase
        if (['Playing', 'ChoosingColor', 'ChoosingPickUntilAction', 'ChoosingSwapHands'].includes(gameState.phase) && gameState.players[gameState.currentPlayerIndex].playerId === playerId) {
            addLog(`It was ${player.name}'s turn. Advancing to next active player.`);
            // If the player was choosing an action, reset that state
            if (gameState.playerChoosingActionId === playerId) {
                 gameState.playerChoosingActionId = null;
                 gameState.phase = 'Playing'; // Default back to playing phase
            }
            advanceTurn();
        }
        
        io.emit('updateGameState', gameState);

    } else if (reconnectTimers[playerId]) {
        clearTimeout(reconnectTimers[playerId]); delete reconnectTimers[playerId];
    }
}

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinGame', ({ playerName, playerId }) => {
    if (gameState && gameState.phase !== 'Lobby' && gameState.phase !== 'GameOver') { // Check if game active
        let playerToRejoin = null;
        if (playerId) {
            playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status !== 'Active');
        }
        if (!playerToRejoin) { /* ... (Hybrid Reconnection Logic - unchanged) ... */
             const disconnectedPlayers = gameState.players.filter(p => p.status !== 'Active'); const joiningPlayerNameLower = playerName.toLowerCase(); if (disconnectedPlayers.length === 1) { playerToRejoin = disconnectedPlayers[0]; } else if (disconnectedPlayers.length > 1) { let bestMatch = null; let longestMatchLength = 0; for (const p of disconnectedPlayers) { const disconnectedNameLower = p.name.toLowerCase(); if (joiningPlayerNameLower.startsWith(disconnectedNameLower)) { if (disconnectedNameLower.length > longestMatchLength) { bestMatch = p; longestMatchLength = disconnectedNameLower.length; } } } playerToRejoin = bestMatch; }
         }

        if (playerToRejoin) {
            console.log(`${playerName} is rejoining as ${playerToRejoin.name}.`);
            playerToRejoin.status = 'Active';
            playerToRejoin.socketId = socket.id;
            playerToRejoin.name = playerName; // Update name on rejoin

            if (reconnectTimers[playerToRejoin.playerId]) {
                clearTimeout(reconnectTimers[playerToRejoin.playerId]); delete reconnectTimers[playerToRejoin.playerId];
            }
            addLog(`Player ${playerToRejoin.name} has reconnected!`);

            const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (otherDisconnected.length === 0 && gameState.isPaused) { // Only unpause if it WAS paused
                gameState.isPaused = false;
                gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
                addLog("All players reconnected. Game resumed.");
            } else if (gameState.isPaused) { // Update pause info if still paused
                gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
            }

            socket.emit('joinSuccess', { playerId: playerToRejoin.playerId, lobby: gameState.players }); // Send player list even on rejoin
            io.emit('updateGameState', gameState);
            return;
        } else {
            socket.emit('announce', 'Game is in progress. Cannot join now.');
            return;
        }
    }

    // --- LOBBY JOIN LOGIC ---
    let pId = playerId;
    if (!pId) pId = Math.random().toString(36).substr(2, 9);
    const existingPlayer = players.find(p => p.playerId === pId);
    if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.name = playerName;
    } else {
        const isHost = players.length === 0;
        players.push({ playerId: pId, socketId: socket.id, name: playerName, isHost });
    }
    socket.emit('joinSuccess', { playerId: pId, lobby: players });
    io.emit('lobbyUpdate', players); // Use io.emit to update everyone including joiner
  });

  socket.on('kickPlayer', ({ playerIdToKick }) => {
    if (gameState && gameState.phase !== 'Lobby') return; // Can only kick from lobby
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host) {
        const playerToKick = players.find(p => p.playerId === playerIdToKick);
        if (playerToKick) {
            console.log(`Host ${host.name} kicked ${playerToKick.name}`);
            players = players.filter(player => player.playerId !== playerIdToKick);
            // Notify kicked player? Optional.
            io.emit('lobbyUpdate', players);
        }
    }
  });

  socket.on('startGame', () => {
    // Game can only start from Lobby phase
    if (gameState && gameState.phase !== 'Lobby') return;
    const host = players.find(p => p.socketId === socket.id && p.isHost);
    if (host && players.length >= 2) {
      gameState = setupGame(players); // setupGame now includes phase: 'Lobby'
      const newDealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
      gameState.dealerIndex = newDealerIndex;
      gameState.playerChoosingActionId = gameState.players[newDealerIndex].playerId; // Dealer chooses deal amount
      gameState.phase = 'Dealing'; // *** NEW: Set phase ***
      players = []; // Clear lobby array as players are now in gameState
      io.emit('updateGameState', gameState);
    }
  });

  function checkAndStartNextRound() {
    // Can only start next round from RoundOver phase
    if (!gameState || gameState.phase !== 'RoundOver') return;
    const host = gameState.players.find(p => p.isHost);
    const connectedPlayers = gameState.players.filter(p => p.status === 'Active');

    if (!host) return; // Should not happen if game is running

    const hostIsReady = gameState.readyForNextRound.includes(host.playerId);
    const allPlayersReady = gameState.readyForNextRound.length === connectedPlayers.length;

    if (hostIsReady && allPlayersReady) {
        const newDealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
        gameState.dealerIndex = newDealerIndex;
        gameState.playerChoosingActionId = gameState.players[newDealerIndex].playerId; // New dealer chooses deal amount
        gameState.phase = 'Dealing'; // *** NEW: Set phase ***
        io.emit('updateGameState', gameState);
    }
  }

  socket.on('playerReadyForNextRound', () => {
      // Can only ready up during RoundOver phase
      if (!gameState || gameState.phase !== 'RoundOver') return;
      const player = gameState.players.find(p => p.socketId === socket.id);
      if (player && player.status === 'Active' && !gameState.readyForNextRound.includes(player.playerId)) { // Ensure player is active
          gameState.readyForNextRound.push(player.playerId);
          checkAndStartNextRound(); // Check if everyone is ready now
          io.emit('updateGameState', gameState); // Update readiness status visually
      }
  });


  socket.on('dealChoice', ({ numCards }) => {
    // Can only deal during Dealing phase
    if (!gameState || gameState.phase !== 'Dealing' || gameState.isPaused) return;
    const dealingPlayer = gameState.players.find(p => p.socketId === socket.id);
      if (gameState.playerChoosingActionId === dealingPlayer?.playerId) {
          const numToDeal = Math.max(1, Math.min(13, parseInt(numCards) || 7));
          gameState.numCardsToDeal = numToDeal;
          gameState.playerChoosingActionId = null; // Clear chooser
          gameState = startNewRound(gameState); // startNewRound now sets the next phase ('Playing' or 'ChoosingColor')
          io.emit('updateGameState', gameState);
      }
  });

  socket.on('endGame', () => {
      if(gameState && gameState.phase !== 'GameOver') { // Prevent ending already ended game
          const player = gameState.players.find(p => p.socketId === socket.id);
          if (player && player.isHost) {
              gameState.phase = 'GameOver'; // *** NEW: Set phase ***
              io.emit('finalGameOver', gameState);
              addLog(`The game has been ended by the host.`);
              gameState = null;
              players = [];
              reconnectTimers = {};
          }
      }
  });

  socket.on('playCard', ({ cardIndex }) => {
    // Only handle if in 'Playing' phase (handleCardPlay checks internally too)
    if (!gameState || gameState.phase !== 'Playing' || gameState.isPaused) return;
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
        handleCardPlay(playerIndex, cardIndex);
        // Only emit update if the game didn't end
        if (gameState && gameState.phase !== 'RoundOver' && gameState.phase !== 'GameOver') {
             io.emit('updateGameState', gameState);
        }
    }
  });

  socket.on('callUno', () => {
    // Can only call UNO during Playing phase (technically, just before playing last card)
    if (!gameState || gameState.phase !== 'Playing' || gameState.isPaused) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    // Can only declare if it's their turn and they have 2 cards
    if (player && player.hand.length === 2 && gameState.players[gameState.currentPlayerIndex].playerId === player.playerId) {
        player.unoState = 'declared';
        addLog(`📣 ${player.name} is ready to call UNO!`);
        // No gameState update needed just for declaration, but send feedback
        socket.emit('announce', 'UNO declared!'); // Optional feedback to player
    }
  });


  socket.on('drawCard', () => {
    // Drawing happens during 'Playing' or a potential 'PickingUntilActive' phase
    // Let's refine the 'PickingUntilActive' concept - maybe just check pickUntilState.active
    if (!gameState || !['Playing'].includes(gameState.phase) || gameState.isPaused) return; // Simplified check for now

    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === gameState.currentPlayerIndex) {
        const player = gameState.players[playerIndex];
        const topCard = gameState.discardPile[0].card;

        // Handle Pick Until draw
        if (gameState.pickUntilState?.active && gameState.pickUntilState.targetPlayerIndex === playerIndex) {
            if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                player.hand.push(drawnCard);
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} is picking for a ${gameState.pickUntilState.targetColor}...`);

                if (drawnCard.color === gameState.pickUntilState.targetColor) {
                    // Found the card! Play it automatically.
                    player.hand.splice(player.hand.findIndex(c => c === drawnCard), 1);
                    gameState.discardPile.unshift({ card: drawnCard, playerName: player.name });
                    gameState.activeColor = drawnCard.color; // Set active color
                    io.to(socket.id).emit('announce', `You drew the target color (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                    addLog(`› ${player.name} found and played a ${drawnCard.color} card.`);

                    const pickUntilChooserId = gameState.pickUntilState.chooserPlayerId; // Need to store who played the PickUntil originally
                    gameState.pickUntilState = null; // Clear state

                     // Check win condition
                    if (player.hand.length === 0) {
                        const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                        handleEndOfRound([player, ...heldWinners]); // Sets phase = RoundOver
                        return; // Stop processing
                    }
                    
                    // Check if original PickUntil player won on hold
                    if (gameState.winnerOnHold.includes(pickUntilChooserId)) {
                        const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                         handleEndOfRound(heldWinners);
                         return;
                    }


                    applyCardEffect(drawnCard); // Apply D2, Reverse, Skip effects

                    // Advance turn(s) based on card played
                    const numActivePlayers = gameState.players.filter(p => p.status === 'Active').length;
                    if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && numActivePlayers === 2)) {
                        advanceTurn();
                    }
                    advanceTurn();
                    gameState.phase = 'Playing'; // Return to normal play

                } else {
                     // Didn't find it, phase remains 'Playing', turn stays with the drawing player
                     // No need to change phase or advance turn
                     player.unoState = 'safe'; // Drawing resets UNO state
                }
            } else {
                 addLog(`Draw pile empty! ${player.name} couldn't find the color.`);
                 gameState.pickUntilState = null; // Clear state
                 advanceTurn(); // Player passes
                 gameState.phase = 'Playing';
            }
        }
        // Handle Draw Penalty draw
        else if (gameState.drawPenalty > 0) {
            const penalty = gameState.drawPenalty;
            for (let i = 0; i < penalty; i++) {
                if (gameState.drawPile.length > 0) player.hand.push(gameState.drawPile.shift());
            }
            io.emit('animateDraw', { playerId: player.playerId, count: penalty });
            addLog(`› ${player.name} drew ${penalty} cards.`);
            player.unoState = 'safe'; // Drawing resets UNO state
            gameState.drawPenalty = 0;

             // Check if held winners can now win
            if (gameState.winnerOnHold.length > 0) {
                 const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
                 // If the current player (who just drew) was NOT one of the held winners, the round ends for the held winners
                 if (!heldWinners.some(w => w.playerId === player.playerId)) {
                     handleEndOfRound(heldWinners);
                     return;
                 } else {
                     // If the current player drew penalty from their own last card, clear the hold
                     gameState.winnerOnHold = [];
                 }
            }

            advanceTurn();
            gameState.phase = 'Playing'; // Ensure phase is Playing
        }
        // Handle Regular draw
        else {
            // Check if player MUST play a card (should be handled client-side ideally, but double check here)
            // const hasPlayableCard = player.hand.some(card => isMoveValid(card, topCard, gameState.activeColor, 0));
            // if (hasPlayableCard) {
            //     io.to(socket.id).emit('announce', 'You have a playable card and must play it.');
            //     return; // Don't allow draw
            // }

            if (gameState.drawPile.length > 0) {
                const drawnCard = gameState.drawPile.shift();
                io.emit('animateDraw', { playerId: player.playerId, count: 1 });
                addLog(`› ${player.name} drew a card.`);

                if (isMoveValid(drawnCard, topCard, gameState.activeColor, 0)) {
                    // Drawn card is playable
                    if (drawnCard.color === 'Black') {
                        // Drawn Wild - Must decide whether to play
                        player.hand.push(drawnCard); // Add to hand first
                        // No automatic UNO declaration on draw
                        const cardIndex = player.hand.length - 1;
                        // Don't change phase, wait for player choice via 'choosePlayDrawnWild'
                        io.to(socket.id).emit('drawnWildCard', { cardIndex, drawnCard });
                        return; // Stop processing, wait for choice
                    } else {
                        // Drawn Color card - Played automatically
                        gameState.discardPile.unshift({ card: drawnCard, playerName: player.name });
                        gameState.activeColor = drawnCard.color;
                        applyCardEffect(drawnCard);
                        io.to(socket.id).emit('announce', `You drew a playable card (${drawnCard.value} ${drawnCard.color}) and it was played for you.`);
                        addLog(`...and it was a playable ${drawnCard.color} ${drawnCard.value}!`);

                        // Check win condition (drawing and playing last card)
                        // Note: handleCardPlay already handles win checks, but this is a special case
                        // If drawing a playable card makes hand empty, they win.
                        // Since card isn't added to hand, length doesn't change here. Check if it *was* 0.
                        // This seems logically tricky. Let's assume drawing + auto-playing cannot win immediately.
                        // Revisit if edge cases arise.

                         player.unoState = 'safe'; // Auto-play doesn't require UNO call

                        // Advance turn(s) based on card played
                        const numActivePlayers = gameState.players.filter(p => p.status === 'Active').length;
                        if (drawnCard.value === 'Skip' || (drawnCard.value === 'Reverse' && numActivePlayers === 2)) {
                            advanceTurn();
                        }
                        advanceTurn();
                        gameState.phase = 'Playing'; // Ensure phase is Playing
                    }
                } else {
                    // Drawn card is not playable
                    player.hand.push(drawnCard);
                    player.unoState = 'safe'; // Drawing resets UNO state
                    advanceTurn();
                    gameState.phase = 'Playing'; // Ensure phase is Playing
                }
            } else {
                addLog(`Draw pile is empty! ${player.name} passes their turn.`);
                advanceTurn();
                gameState.phase = 'Playing'; // Ensure phase is Playing
            }
        }
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('choosePlayDrawnWild', ({ play, cardIndex }) => {
     // This action can only happen when phase is implicitly 'Playing' but waiting for this choice
     if (!gameState || !['Playing'].includes(gameState.phase) || gameState.isPaused) return;

    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    const player = gameState.players[playerIndex];

    if (playerIndex !== gameState.currentPlayerIndex) return; // Must be current player

    if (play) {
        // Player chose to play the drawn Wild card
        // Check if index is valid (should be the last card)
        if (cardIndex !== player.hand.length - 1) {
             console.error("Drawn wild card index mismatch!"); return;
        }
        // Need to transition state correctly - handleCardPlay expects 'Playing'
        // Temporarily ensure state is 'Playing' for handleCardPlay logic
        gameState.phase = 'Playing';
        handleCardPlay(playerIndex, cardIndex); // This will handle phase changes (e.g., to ChoosingColor)
    } else {
        // Player chose to keep the card
        addLog(`› ${player.name} chose to keep the drawn Wild card.`);
        advanceTurn();
        gameState.phase = 'Playing'; // Ensure phase remains Playing
    }
    // Only emit update if the game didn't end
    if (gameState && gameState.phase !== 'RoundOver' && gameState.phase !== 'GameOver') {
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('pickUntilChoice', ({ choice }) => {
    // Can only choose action during ChoosingPickUntilAction phase
    if (!gameState || gameState.phase !== 'ChoosingPickUntilAction' || gameState.isPaused) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (gameState.playerChoosingActionId !== player?.playerId) return; // Must be the correct player

    const numPlayers = gameState.players.length;
    const originalPlayerIndex = gameState.players.findIndex(p => p.socketId === socket.id);

    if (choice === 'discard-wilds') {
        const msg = `🌪️ ${player.name} chose 'All players discard Wilds'!`; addLog(msg); io.emit('announce', msg);
        const winners = []; const allDiscardedData = [];

        gameState.players.forEach(p => {
            if (p.socketId !== socket.id && p.status === 'Active') { // Only affect active players
                const originalHandSize = p.hand.length;
                if (originalHandSize > 0) {
                    const discardedCards = p.hand.filter(card => card.color === 'Black');
                    if (discardedCards.length > 0) allDiscardedData.push({ playerName: p.name, cards: discardedCards });
                    p.hand = p.hand.filter(card => card.color !== 'Black');
                    if (p.hand.length === 0) winners.push(p);
                    // Automatic UNO call if reduced to 1 card? Per rules, yes.
                    else if (p.hand.length === 1 && originalHandSize > 1) {
                         p.unoState = 'declared'; io.emit('unoCalled', { playerName: p.name });
                    }
                }
            }
        });

        io.emit('showDiscardWildsModal', allDiscardedData);
        if (allDiscardedData.length === 0) addLog('...but no other players had any Wild cards.');

        if (winners.length > 0) {
            const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
            handleEndOfRound([...winners, ...heldWinners]); // Sets phase = RoundOver
            return; // Stop processing
        }
        // Check if original PickUntil player won on hold
        if (gameState.winnerOnHold.includes(player.playerId)) {
             const heldWinners = gameState.players.filter(p => gameState.winnerOnHold.includes(p.playerId));
             handleEndOfRound(heldWinners);
             return;
        }

        gameState.phase = 'ChoosingColor'; // *** NEW: Set phase *** (Player still needs to choose color)
        // playerChoosingActionId remains the same

    } else if (choice === 'pick-color') {
        const msg = `🎨 ${player.name} chose 'Next player picks until color'.`; addLog(msg); io.emit('announce', msg);

        let nextPlayerIndex = -1;
        let searchIndex = originalPlayerIndex;
        let searchLimit = numPlayers;
        do {
            searchIndex = (searchIndex + gameState.playDirection + numPlayers) % numPlayers;
            if (gameState.players[searchIndex].status === 'Active') {
                 nextPlayerIndex = searchIndex;
                 break;
            }
            searchLimit--;
        } while (searchLimit > 0);


        if (nextPlayerIndex !== -1 && nextPlayerIndex !== originalPlayerIndex) {
            gameState.pickUntilState = {
                chooserPlayerId: player.playerId, // Store who initiated
                targetPlayerIndex: nextPlayerIndex,
                active: false, // Not active until color chosen
                targetColor: null
            };
            gameState.phase = 'ChoosingColor'; // *** NEW: Set phase ***
            // playerChoosingActionId remains the same
        } else {
            addLog('No other active players to target. Turn continues after color choice.');
             gameState.pickUntilState = null; // Clear any partial state
            gameState.phase = 'ChoosingColor'; // *** NEW: Still need to choose color ***
             // playerChoosingActionId remains the same
        }
    }
    // No longer need needsPickUntilChoice = null
    io.emit('updateGameState', gameState);
  });

  socket.on('swapHandsChoice', ({ targetPlayerId }) => {
    // Can only swap during ChoosingSwapHands phase
    if (!gameState || gameState.phase !== 'ChoosingSwapHands' || gameState.isPaused) return;
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (gameState.playerChoosingActionId !== choosingPlayer?.playerId) return;

    const targetPlayer = gameState.players.find(p => p.playerId === targetPlayerId && p.status === 'Active'); // Can only swap with active player
    if (choosingPlayer && targetPlayer) {
        io.emit('animateSwap', { p1_id: choosingPlayer.playerId, p2_id: targetPlayer.playerId });
        [choosingPlayer.hand, targetPlayer.hand] = [targetPlayer.hand, choosingPlayer.hand];

        // Update UNO states after swap
        [choosingPlayer, targetPlayer].forEach(p => {
             if (p.hand.length === 1) {
                 p.unoState = 'declared'; io.emit('unoCalled', { playerName: p.name });
             } else {
                 p.unoState = 'safe';
             }
        });


        const msg = `🤝 ${choosingPlayer.name} swapped hands with ${targetPlayer.name}!`; // Color already announced
        addLog(msg); io.emit('announce', msg);

        gameState.playerChoosingActionId = null; // Clear chooser
        gameState.swapState = null; // Clear swap intent
        advanceTurn(); // Turn advances AFTER swap
        gameState.phase = 'Playing'; // *** NEW: Set phase ***
    } else {
         addLog(`Target player ${targetPlayerId} not found or not active.`);
         // Keep phase as ChoosingSwapHands for chooser to try again? Or reset? Let's reset.
         gameState.phase = 'Playing'; // Go back to playing phase
         advanceTurn(); // Advance turn from the original swapper
    }
    io.emit('updateGameState', gameState);
  });

  socket.on('colorChosen', ({ color }) => {
     // Can only choose color during ChoosingColor phase
    if (!gameState || gameState.phase !== 'ChoosingColor' || gameState.isPaused) return;
    const choosingPlayer = gameState.players.find(p => p.socketId === socket.id);
    if (gameState.playerChoosingActionId !== choosingPlayer?.playerId) return;

    addLog(`🎨 ${choosingPlayer.name} chose the color ${color}.`);
    gameState.activeColor = color; // Set active color regardless of context

    const wasDealerChoosingFirstCard = gameState.discardPile.length === 1 && gameState.players[gameState.dealerIndex].playerId === choosingPlayer.playerId;

    if (gameState.swapState) { // Color choice was for a Wild Swap
        gameState.phase = 'ChoosingSwapHands'; // *** NEW: Transition to swap choice phase ***
        // playerChoosingActionId remains the same
    } else if (gameState.pickUntilState) { // Color choice was for Pick Until
        gameState.pickUntilState.active = true;
        gameState.pickUntilState.targetColor = color;
        // Turn immediately goes to the target player
        gameState.currentPlayerIndex = gameState.pickUntilState.targetPlayerIndex;
        const targetPlayer = gameState.players[gameState.pickUntilState.targetPlayerIndex];
        const msg = `› ${targetPlayer.name} must now pick until they find a ${color} card!`;
        addLog(msg); io.emit('announce', msg);
        gameState.phase = 'Playing'; // *** NEW: Phase is 'Playing', but draw logic will check pickUntilState ***
        gameState.playerChoosingActionId = null; // Clear chooser
    } else { // Color choice was for regular Wild / WD4 / or initial dealer Wild
        // Announce color choice unless it was the very first card by dealer
        if (!wasDealerChoosingFirstCard) {
            const msg = `✨ ${choosingPlayer.name} chose ${color}.`;
            io.emit('announce', msg);
        }

        // Apply WD4 effect AFTER color is chosen
        const playedCard = gameState.discardPile[0]?.card;
        if(playedCard?.value === 'Wild Draw Four' && !wasDealerChoosingFirstCard) {
             applyCardEffect(playedCard); // Adds draw penalty
        }


        // Advance turn unless it was the very first card by dealer
        if (!wasDealerChoosingFirstCard) {
             advanceTurn();
        }
        gameState.phase = 'Playing'; // *** NEW: Set phase ***
        gameState.playerChoosingActionId = null; // Clear chooser
    }
    // No longer need needsColorChoice = null
    io.emit('updateGameState', gameState);
  });

  socket.on('rearrangeHand', ({ newHand }) => {
    // No phase check needed for rearranging
    if (!gameState) return;
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (player) {
        // Basic validation: ensure card counts match
        if (newHand.length === player.hand.length) {
            // More robust validation could check if all cards still exist
            player.hand = newHand;
             // No need to broadcast, only affects this player's view
             // socket.emit('updateGameState', gameState); // Send ONLY to rearranging player if needed
        }
    }
  });

  socket.on('markPlayerAFK', ({ playerIdToMark }) => {
    // Can mark AFK during any active game phase
    if (!gameState || ['Lobby', 'GameOver'].includes(gameState.phase) || gameState.isPaused) return;

    const host = gameState.players.find(p => p.socketId === socket.id && p.isHost);
    const playerToMark = gameState.players.find(p => p.playerId === playerIdToMark);

    if (host && playerToMark && playerToMark.status === 'Active') {
        playerToMark.status = 'Disconnected';
        addLog(`Host ${host.name} marked ${playerToMark.name} as AFK. The game is paused.`);
        gameState.isPaused = true;
        const pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
        const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        gameState.pauseInfo = { pauseEndTime: pauseEndTime, pausedForPlayerNames: allDisconnected.map(p => p.name) };
        if (reconnectTimers[playerToMark.playerId]) clearTimeout(reconnectTimers[playerToMark.playerId]);
        reconnectTimers[playerToMark.playerId] = setTimeout(() => handlePlayerRemoval(playerToMark.playerId), DISCONNECT_GRACE_PERIOD);
        io.to(playerToMark.socketId).emit('youWereMarkedAFK');
        io.emit('updateGameState', gameState);
    }
  });

  socket.on('playerIsBack', () => {
    // Can come back during any phase if game exists
    if (!gameState || gameState.phase === 'GameOver') return;
    const player = gameState.players.find(p => p.socketId === socket.id);

    if (player && player.status === 'Disconnected') {
        player.status = 'Active'; addLog(`Player ${player.name} is back!`);
        if (reconnectTimers[player.playerId]) { clearTimeout(reconnectTimers[player.playerId]); delete reconnectTimers[player.playerId]; }
        const otherDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
        if (otherDisconnected.length === 0 && gameState.isPaused) {
            gameState.isPaused = false;
            gameState.pauseInfo = { pauseEndTime: null, pausedForPlayerNames: [] };
            addLog("All players are back. Game resumed.");
        } else if (gameState.isPaused) {
            gameState.pauseInfo.pausedForPlayerNames = otherDisconnected.map(p => p.name);
        }
        io.emit('updateGameState', gameState);
    }
  });


  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    if (gameState && gameState.phase !== 'GameOver') { // Handle disconnect during active game
        const disconnectedPlayer = gameState.players.find(p => p.socketId === socket.id);
        if (disconnectedPlayer && disconnectedPlayer.status === 'Active') {
            disconnectedPlayer.status = 'Disconnected';
            addLog(`Player ${disconnectedPlayer.name} has disconnected. The game is paused.`);
            gameState.isPaused = true;
            const pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
            const allDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            gameState.pauseInfo = { pauseEndTime: pauseEndTime, pausedForPlayerNames: allDisconnected.map(p => p.name) };
            if (reconnectTimers[disconnectedPlayer.playerId]) clearTimeout(reconnectTimers[disconnectedPlayer.playerId]);
            reconnectTimers[disconnectedPlayer.playerId] = setTimeout(() => handlePlayerRemoval(disconnectedPlayer.playerId), DISCONNECT_GRACE_PERIOD);
            io.emit('updateGameState', gameState);
        }
    } else { // Handle disconnect from lobby
        const playerInLobby = players.find(player => player.socketId === socket.id);
        if (playerInLobby) {
            players = players.filter(player => player.socketId !== socket.id);
            if (playerInLobby.isHost && players.length > 0) {
                players[0].isHost = true;
            }
            io.emit('lobbyUpdate', players);
        }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ UNO Server is live and listening on port ${PORT}`);
});