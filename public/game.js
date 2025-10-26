window.addEventListener('DOMContentLoaded', () => {
    const socket = io({
        query: {
            playerId: sessionStorage.getItem('unoPlayerId')
        }
    });

    let myPersistentPlayerId = sessionStorage.getItem('unoPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('unoPlayerName');
    let myHand = [];
    let currentGameState = {};
    
    // *** NEW: Variables for new features ***
    let previousGameState = null; // For move announcement diff
    let moveAnnouncementTimeout = null; // Timer for move announcement
    let rainInterval = null; // Timer for rain animation
    let pauseCountdownInterval;
    let pauseCountdownIntervalMobile; // This was in SOH, let's add it here too

    // --- Element Cache ---
    const $ = (id) => document.getElementById(id);
    const elements = {
        joinScreen: $('join-screen'),
        lobbyScreen: $('lobby-screen'),
        gameBoardContainer: $('game-board-container'),
        playerNameInput: $('player-name-input'),
        joinGameBtn: $('join-game-btn'),
        playerList: $('player-list'),
        readyBtn: $('ready-btn'),
        hostPasswordInput: $('host-password-input'),
        startGameBtn: $('start-game-btn'),
        hardResetBtn: $('hard-reset-btn'),
        playerLobbyActions: $('player-lobby-actions'),
        hostLobbyActions: $('host-lobby-actions'),
        hostMessage: $('host-message'),
        gameStatusBanner: $('game-status-banner'), // NEW
        moveAnnouncementBanner: $('move-announcement-banner'), // NEW
        opponentHands: $('opponent-hands'),
        drawCardBtn: $('draw-card-btn'),
        drawPileCount: $('draw-pile-count'),
        discardPileCard: $('discard-pile-card'),
        currentColorIndicator: $('current-color-indicator'),
        turnOrderIndicator: $('turn-order-indicator'),
        myHand: $('my-hand'),
        unoBtn: $('uno-btn'),
        myName: $('my-name'),
        myCardCount: $('my-card-count'),
        showPlayersBtn: $('show-players-btn'),
        showLogsBtn: $('show-logs-btn'),
        endGameBtn: $('end-game-btn'),
        playersModal: $('players-modal'),
        playersModalClose: $('players-modal-close'),
        playersTableBody: $('players-table-body'),
        playersModalOkBtn: $('players-modal-ok-btn'),
        hostActionColHeader: $('host-action-col-header'),
        gameLogModal: $('game-log-modal'),
        gameLogModalClose: $('game-log-modal-close'),
        gameLogContent: $('game-log-content'),
        gameLogModalOkBtn: $('game-log-modal-ok-btn'),
        chooseColorModal: $('choose-color-modal'),
        colorPicker: $('choose-color-modal').querySelector('.color-picker'),
        wildSwapModal: $('wild-swap-modal'),
        wildSwapTitle: $('wild-swap-title'),
        wildSwapColorPicker: $('wild-swap-color-picker'),
        wildSwapPlayerList: $('wild-swap-player-list'),
        swapPlayerListUl: $('swap-player-list-ul'),
        wildPickUntilModal: $('wild-pick-until-modal'),
        wildPickUntilTitle: $('wild-pick-until-title'),
        wildPickColorPicker: $('wild-pick-color-picker'),
        wildPickActionButtons: $('wild-pick-action-buttons'),
        wildPickChosenColor: $('wild-pick-chosen-color'),
        wildPickActionPick: $('wild-pick-action-pick'),
        wildPickActionDiscard: $('wild-pick-action-discard'),
        wildDrawChoiceModal: $('wild-draw-choice-modal'),
        drawnWildCardDisplay: $('drawn-wild-card-display'),
        playDrawnWildBtn: $('play-drawn-wild-btn'),
        keepDrawnWildBtn: $('keep-drawn-wild-btn'),
        gameOverModal: $('game-over-modal'),
        gameOverTitle: $('game-over-title'),
        gameOverWinnerText: $('game-over-winner-text'),
        gameOverScoreboard: $('game-over-scoreboard'),
        scoreboardModal: $('scoreboard-modal'),
        scoreboardTitle: $('scoreboard-title'),
        scoreboardModalClose: $('scoreboard-modal-close'),
        scoreboardWinnerText: $('scoreboard-winner-text'),
        scoreboardContent: $('scoreboard-content'),
        roundOverHands: $('round-over-hands'), // NEW
        scoreboardNextRoundBtn: $('scoreboard-next-round-btn'),
        scoreboardOkBtn: $('scoreboard-ok-btn'),
        scoreboardEndGameBtn: $('scoreboard-end-game-btn'),
        confirmEndGameModal: $('confirm-end-game-modal'),
        confirmEndYesBtn: $('confirm-end-yes-btn'),
        confirmEndNoBtn: $('confirm-end-no-btn'),
        confirmHardResetModal: $('confirm-hard-reset-modal'),
        confirmResetYesBtn: $('confirm-reset-yes-btn'),
        confirmResetNoBtn: $('confirm-reset-no-btn'),
        afkNotificationModal: $('afk-notification-modal'),
        imBackBtn: $('im-back-btn'),
        warningModal: $('warning-modal'),
        warningModalTitle: $('warning-modal-title'),
        warningModalText: $('warning-modal-text'),
        warningModalOkBtn: $('warning-modal-ok-btn'),
        waitingForHostModal: $('waiting-for-host-modal'),
    };

    // --- Event Listeners ---
    setupJoinScreenListeners();
    setupLobbyEventListeners();
    setupGameEventListeners();
    setupModalEventListeners();
    makeModalsDraggable();

    // --- Socket Listeners ---
    socket.on('connect', () => {
        console.log('Connected to server.');
        myPersistentPlayerId = sessionStorage.getItem('unoPlayerId');
        myPersistentPlayerName = sessionStorage.getItem('unoPlayerName');
        if (myPersistentPlayerId) {
            console.log('Attempting to rejoin with existing ID:', myPersistentPlayerId);
            socket.io.opts.query.playerId = myPersistentPlayerId;
            socket.emit('joinGame', { playerName: myPersistentPlayerName, playerId: myPersistentPlayerId });
        }
    });

    socket.on('joinSuccess', (playerId) => {
        console.log('Join successful. Player ID:', playerId);
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('unoPlayerId', playerId);
        elements.joinScreen.style.display = 'none';
        elements.lobbyScreen.style.display = 'block';
        elements.gameBoardContainer.style.display = 'none';
    });

    socket.on('joinFailed', (message) => {
        console.error('Join failed:', message);
        sessionStorage.removeItem('unoPlayerId');
        sessionStorage.removeItem('unoPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        socket.io.opts.query.playerId = null;
        showWarning('Join Failed', message);
        elements.joinScreen.style.display = 'block';
        elements.lobbyScreen.style.display = 'none';
        elements.gameBoardContainer.style.display = 'none';
    });

    socket.on('lobbyUpdate', (players) => {
        console.log('Lobby updated:', players);
        elements.gameBoardContainer.style.display = 'none';
        elements.joinScreen.style.display = 'none';
        elements.lobbyScreen.style.display = 'block';
        elements.gameOverModal.classList.add('hidden');
        renderLobby(players);
    });

    socket.on('gameStarted', () => {
        console.log('Game started!');
        elements.lobbyScreen.style.display = 'none';
        elements.gameBoardContainer.style.display = 'flex';
    });

    socket.on('updateGameState', (gs) => {
        console.log('Received GameState:', gs);
        
        // *** NEW: Handle move announcements ***
        handleMoveAnnouncement(gs, previousGameState);
        previousGameState = JSON.parse(JSON.stringify(gs)); // Deep copy

        currentGameState = gs;
        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
            console.warn('My player data not found in game state.');
            // This might happen if player was kicked, force back to join
            forceDisconnect();
            return;
        }

        myHand = me.hand; // Update local hand
        renderOpponentHands(gs.players, me.playerId, gs.currentPlayerId);
        renderPiles(gs.drawPile.length, gs.discardPile);
        renderGameInfo(gs.currentColor, gs.turnDirection);
        renderMyHand(me, gs.discardPile, gs.currentColor);
        renderMyInfo(me);
        renderActionButtons(me, gs.currentPlayerId);
        renderPlayersModal(gs.players, me, gs.currentPlayerId);
        renderGameLog(gs.logHistory);
        
        // *** NEW: Render status banner ***
        renderGameStatusBanner(gs, me);
        
        // Handle pause state
        if (gs.isPaused) {
            // Handled by renderGameStatusBanner
        } else {
            if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        }

        // Handle pending actions
        if (gs.pendingAction && gs.pendingAction.playerSocketId === socket.id) {
            // This client has a pending action, but it's handled by specific emitters
        } else {
            // Hide all action modals if no action is pending for me
            hideAllActionModals();
        }
    });

    socket.on('cardsDrawn', (drawnCards) => {
        console.log('You drew cards:', drawnCards);
        // We don't need to do anything here, 'updateGameState' will follow
    });

    socket.on('chooseColor', (card) => {
        console.log('Action: chooseColor');
        elements.chooseColorModal.classList.remove('hidden');
    });

    socket.on('wild-swap', (card) => {
        console.log('Action: wild-swap');
        elements.wildSwapTitle.textContent = 'Choose a Color';
        elements.wildSwapColorPicker.style.display = 'flex';
        elements.wildSwapPlayerList.style.display = 'none';
        renderWildSwapPlayerList();
        elements.wildSwapModal.classList.remove('hidden');
    });

    socket.on('wild-pick-until', (card) => {
        console.log('Action: wild-pick-until');
        elements.wildPickUntilTitle.textContent = 'Choose a Color';
        elements.wildPickColorPicker.style.display = 'flex';
        elements.wildPickActionButtons.style.display = 'none';
        elements.wildPickUntilModal.classList.remove('hidden');
    });

    socket.on('wildDrawChoice', (card) => {
        console.log('Action: wildDrawChoice');
        elements.drawnWildCardDisplay.innerHTML = '';
        elements.drawnWildCardDisplay.appendChild(createCardImage(card));
        elements.wildDrawChoiceModal.classList.remove('hidden');
    });

    // *** MODIFIED: Handle 'roundOver' for new animation ***
    socket.on('roundOver', (data) => {
        console.log('Round over:', data);
        elements.waitingForHostModal.classList.add('hidden');
        
        // Show winner animation first, then show modal in the callback
        showWinnerAnnouncement(data.winnerName + " wins the Round!", null, 5000, () => {
            showRoundOverModal(data);
        });
    });

    // *** NEW: Listener for game over animation ***
    socket.on('gameOverAnnouncement', ({ winnerNames }) => {
        elements.scoreboardModal.classList.add('hidden');
        elements.waitingForHostModal.classList.add('hidden');

        let winnerText = "";
        if (!winnerNames || winnerNames.length === 0) {
            winnerText = "Game Over!";
        } else if (winnerNames.length === 1) {
            winnerText = winnerNames[0] + " wins the Game!";
        } else {
            winnerText = "Joint Winners: " + winnerNames.join(', ') + "!";
        }
        const subtext = "You will be taken to the lobby shortly...";
        // Show animation for 11.5 seconds, server will send next event at 12s
        showWinnerAnnouncement(winnerText, subtext, 11500, null);
    });

    // *** MODIFIED: 'gameEnded' now just shows the final modal ***
    socket.on('gameEnded', (data) => {
        console.log('Game ended:', data);
        hideWinnerAnnouncement(); // Hide animation
        renderGameOver(data); // Show final modal
    });

    socket.on('warning', (message) => {
        console.warn('Server Warning:', message);
        showWarning('Alert', message);
    });

    socket.on('youWereMarkedAFK', () => {
        elements.afkNotificationModal.classList.remove('hidden');
    });
    
    socket.on('forceDisconnect', () => {
        console.log('Force disconnected by server.');
        forceDisconnect();
    });

    // --- Setup Functions ---
    function setupJoinScreenListeners() {
        elements.joinGameBtn.addEventListener('click', () => {
            const playerName = elements.playerNameInput.value.trim();
            if (playerName) {
                myPersistentPlayerName = playerName;
                sessionStorage.setItem('unoPlayerName', playerName);
                socket.emit('joinGame', { playerName: playerName, playerId: myPersistentPlayerId });
            }
        });
    }

    function setupLobbyEventListeners() {
        elements.readyBtn.addEventListener('click', () => {
            socket.emit('setPlayerReady', true);
        });
        elements.startGameBtn.addEventListener('click', () => {
            const hostPassword = elements.hostPasswordInput.value;
            const cardsToDeal = 7; // This is hardcoded for now
            socket.emit('startGame', { hostPassword, settings: { cardsToDeal } });
        });
        elements.hardResetBtn.addEventListener('click', () => {
            elements.confirmHardResetModal.classList.remove('hidden');
        });
    }

    function setupGameEventListeners() {
        elements.drawCardBtn.addEventListener('click', () => {
            socket.emit('drawCard');
        });
        elements.unoBtn.addEventListener('click', () => {
            socket.emit('declareUNO');
        });
        elements.myHand.addEventListener('click', (e) => {
            const cardEl = e.target.closest('.card-img');
            if (cardEl && cardEl.classList.contains('playable')) {
                const cardId = parseInt(cardEl.dataset.id, 10);
                socket.emit('playCard', cardId);
            }
        });
    }

    function setupModalEventListeners() {
        // Players Modal
        elements.showPlayersBtn.addEventListener('click', () => elements.playersModal.classList.remove('hidden'));
        elements.playersModalClose.addEventListener('click', () => elements.playersModal.classList.add('hidden'));
        elements.playersModalOkBtn.addEventListener('click', () => elements.playersModal.classList.add('hidden'));
        elements.playersTableBody.addEventListener('click', (e) => {
             const afkBtn = e.target.closest('.afk-btn');
             if (afkBtn) {
                const playerIdToMark = afkBtn.dataset.playerId;
                socket.emit('markPlayerAFK', playerIdToMark);
            }
        });

        // Game Log Modal
        elements.showLogsBtn.addEventListener('click', () => elements.gameLogModal.classList.remove('hidden'));
        elements.gameLogModalClose.addEventListener('click', () => elements.gameLogModal.classList.add('hidden'));
        elements.gameLogModalOkBtn.addEventListener('click', () => elements.gameLogModal.classList.add('hidden'));

        // Choose Color Modal
        elements.colorPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-choice')) {
                const color = e.target.dataset.color;
                socket.emit('resolvePendingAction', { color: color });
                elements.chooseColorModal.classList.add('hidden');
            }
        });

        // Wild Swap Modal
        elements.wildSwapColorPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-choice')) {
                const color = e.target.dataset.color;
                elements.wildSwapColorPicker.style.display = 'none';
                elements.wildSwapPlayerList.style.display = 'block';
                elements.wildSwapTitle.textContent = 'Choose a Player to Swap With';
                elements.wildSwapModal.dataset.chosenColor = color; // Store color
            }
        });
        elements.swapPlayerListUl.addEventListener('click', (e) => {
            const playerLi = e.target.closest('li');
            if (playerLi) {
                const targetPlayerId = playerLi.dataset.playerId;
                const color = elements.wildSwapModal.dataset.chosenColor;
                socket.emit('resolvePendingAction', { color: color, targetPlayerId: targetPlayerId });
                elements.wildSwapModal.classList.add('hidden');
            }
        });

        // Wild Pick Until Modal
        elements.wildPickColorPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-choice')) {
                const color = e.target.dataset.color;
                elements.wildPickColorPicker.style.display = 'none';
                elements.wildPickActionButtons.style.display = 'block';
                elements.wildPickChosenColor.textContent = color;
                elements.wildPickChosenColor.style.color = `var(--color-${color.toLowerCase()})`;
                elements.wildPickUntilModal.dataset.chosenColor = color;
            }
        });
        elements.wildPickActionPick.addEventListener('click', () => {
            const color = elements.wildPickUntilModal.dataset.chosenColor;
            socket.emit('resolvePendingAction', { color: color, action: 'pick' });
            elements.wildPickUntilModal.classList.add('hidden');
        });
        elements.wildPickActionDiscard.addEventListener('click', () => {
            const color = elements.wildPickUntilModal.dataset.chosenColor;
            socket.emit('resolvePendingAction', { color: color, action: 'discard' });
            elements.wildPickUntilModal.classList.add('hidden');
        });

        // Wild Draw Choice Modal
        elements.playDrawnWildBtn.addEventListener('click', () => {
            socket.emit('resolvePendingAction', { play: true });
            elements.wildDrawChoiceModal.classList.add('hidden');
        });
        elements.keepDrawnWildBtn.addEventListener('click', () => {
            socket.emit('resolvePendingAction', { play: false });
            elements.wildDrawChoiceModal.classList.add('hidden');
        });

        // Scoreboard Modal
        elements.scoreboardModalClose.addEventListener('click', () => elements.scoreboardModal.classList.add('hidden'));
        elements.scoreboardOkBtn.addEventListener('click', () => {
            elements.scoreboardModal.classList.add('hidden');
            elements.waitingForHostModal.classList.remove('hidden');
        });
        elements.scoreboardNextRoundBtn.addEventListener('click', () => {
            socket.emit('requestNextRound');
            elements.scoreboardModal.classList.add('hidden');
        });
        elements.scoreboardEndGameBtn.addEventListener('click', () => {
            elements.scoreboardModal.classList.add('hidden');
            elements.confirmEndGameModal.classList.remove('hidden');
        });

        // End Game / Reset Modals
        elements.endGameBtn.addEventListener('click', () => elements.confirmEndGameModal.classList.remove('hidden'));
        elements.confirmEndYesBtn.addEventListener('click', () => {
            socket.emit('endSession');
            elements.confirmEndGameModal.classList.add('hidden');
        });
        elements.confirmEndNoBtn.addEventListener('click', () => elements.confirmEndGameModal.classList.add('hidden'));
        elements.confirmResetYesBtn.addEventListener('click', () => {
            socket.emit('hardReset');
            elements.confirmHardResetModal.classList.add('hidden');
        });
        elements.confirmResetNoBtn.addEventListener('click', () => elements.confirmHardResetModal.classList.add('hidden'));
        elements.imBackBtn.addEventListener('click', () => {
            socket.emit('playerIsBack');
            elements.afkNotificationModal.classList.add('hidden');
        });
        elements.warningModalOkBtn.addEventListener('click', () => elements.warningModal.classList.add('hidden'));
    }

    // --- Render Functions ---
    function renderLobby(players) {
        elements.playerList.innerHTML = '';
        const me = players.find(p => p.playerId === myPersistentPlayerId);

        if (!me) {
            // This can happen if the player was kicked
            forceDisconnect();
            return;
        }

        players.forEach(p => {
            const li = document.createElement('li');
            let status = '';
            if (p.isHost) {
                status = '👑';
            } else if (p.isReady) {
                status = '<span style="color: green;">✅ Ready</span>';
            } else {
                status = '<span style="color: #b00;">❌ Not Ready</span>';
            }
            
            li.innerHTML = `<span>${p.name} ${status}</span>`;
            
            if (me.isHost && p.playerId !== me.playerId) {
                li.innerHTML += `<button class="kick-btn danger-btn" data-player-id="${p.playerId}">Kick</button>`;
            }
            elements.playerList.appendChild(li);
        });

        // Toggle host/player controls
        if (me.isHost) {
            elements.playerLobbyActions.style.display = 'none';
            elements.hostLobbyActions.style.display = 'block';
            elements.hostMessage.style.display = 'none';
            // Enable start button only if all other players are ready
            const allOthersReady = players.every(p => p.isHost || p.isReady);
            elements.startGameBtn.disabled = !allOthersReady;
        } else {
            elements.playerLobbyActions.style.display = 'block';
            elements.hostLobbyActions.style.display = 'none';
            elements.hostMessage.style.display = 'block';
            elements.readyBtn.disabled = me.isReady;
            elements.readyBtn.textContent = me.isReady ? 'Ready!' : 'Ready';
            elements.readyBtn.classList.toggle('confirm-btn', me.isReady);
        }
    }

    function renderOpponentHands(players, myId, currentPlayerId) {
        elements.opponentHands.innerHTML = '';
        const opponents = players.filter(p => p.playerId !== myId && p.status === 'Active');
        
        opponents.forEach(opp => {
            const oppHandDiv = document.createElement('div');
            oppHandDiv.className = 'opponent-hand';
            if (opp.playerId === currentPlayerId) {
                oppHandDiv.classList.add('active-player');
            }
            
            const cardBack = document.createElement('img');
            cardBack.src = '/assets/cards/card_back.png';
            cardBack.alt = 'Opponent Card';
            cardBack.className = 'card-img';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'opponent-name';
            nameDiv.textContent = opp.name;
            
            const countDiv = document.createElement('div');
            countDiv.className = 'opponent-card-count';
            countDiv.textContent = `${opp.hand.length} Cards`;
            
            oppHandDiv.appendChild(cardBack);
            oppHandDiv.appendChild(nameDiv);
            oppHandDiv.appendChild(countDiv);

            if (opp.unoState === 'declared') {
                const unoStatusDiv = document.createElement('div');
                unoStatusDiv.className = 'uno-status';
                unoStatusDiv.textContent = 'UNO!';
                oppHandDiv.appendChild(unoStatusDiv);
            }
            
            elements.opponentHands.appendChild(oppHandDiv);
        });
    }

    function renderPiles(drawCount, discardPile) {
        elements.drawPileCount.textContent = drawCount;
        elements.drawCardBtn.disabled = (currentGameState.currentPlayerId !== myPersistentPlayerId || currentGameState.isPaused || currentGameState.pendingAction);

        if (discardPile.length > 0) {
            const topCard = discardPile[discardPile.length - 1];
            elements.discardPileCard.src = getCardImagePath(topCard);
            elements.discardPileCard.alt = `${topCard.color} ${topCard.value}`;
        } else {
            elements.discardPileCard.src = '/assets/cards/card_back.png'; // Should not happen
            elements.discardPileCard.alt = 'Discard Pile';
        }
    }

    function renderGameInfo(currentColor, turnDirection) {
        if (currentColor) {
            elements.currentColorIndicator.style.backgroundColor = `var(--color-${currentColor.toLowerCase()})`;
        } else {
            elements.currentColorIndicator.style.backgroundColor = '#fff';
        }
        elements.turnOrderIndicator.textContent = turnDirection === 1 ? '▶️' : '◀️';
    }

    function renderMyHand(me, discardPile, currentColor) {
        elements.myHand.innerHTML = '';
        const topCard = discardPile.length > 0 ? discardPile[discardPile.length - 1] : null;
        const isMyTurn = currentGameState.currentPlayerId === me.playerId && !currentGameState.isPaused && !currentGameState.pendingAction;

        me.hand.sort((a, b) => {
            if (a.color < b.color) return -1;
            if (a.color > b.color) return 1;
            if (a.value < b.value) return -1;
            if (a.value > b.value) return 1;
            return 0;
        });

        me.hand.forEach(card => {
            const cardEl = createCardImage(card);
            if (isMyTurn && isPlayable(card, topCard, currentColor)) {
                cardEl.classList.add('playable');
            }
            elements.myHand.appendChild(cardEl);
        });

        // Handle UNO button glowing
        if (me.hand.length === 2 && me.unoState !== 'declared') {
            elements.unoBtn.classList.add('glowing');
        } else {
            elements.unoBtn.classList.remove('glowing');
        }
    }
    
    function renderMyInfo(me) {
        elements.myName.textContent = me.name;
        elements.myCardCount.textContent = me.hand.length;
    }

    function renderActionButtons(me, currentPlayerId) {
        elements.endGameBtn.style.display = me.isHost ? 'block' : 'none';
        elements.unoBtn.disabled = (me.hand.length !== 2 || me.unoState === 'declared');
    }

    function renderPlayersModal(players, me, currentPlayerId) {
        elements.playersTableBody.innerHTML = '';
        let showActionColumn = false;

        players.forEach(p => {
            const row = document.createElement('tr');
            if (p.playerId === currentPlayerId) {
                row.classList.add('active-player-row');
            }
            
            let status = '';
            if (p.status === 'Disconnected') {
                status = '<span class="player-status-badge reconnecting">Offline</span>';
            } else if (p.status === 'Removed') {
                status = '<span class="player-status-badge afk">Removed</span>';
            }
            
            // Player Name Cell
            const nameCell = document.createElement('td');
            nameCell.innerHTML = `${p.name} ${p.isHost ? '👑' : ''} ${p.isDealer ? '(D)' : ''} ${status}`;
            
            // Cards Cell
            const cardsCell = document.createElement('td');
            cardsCell.className = 'col-cards';
            cardsCell.textContent = p.hand.length;
            
            // Score Cell
            const scoreCell = document.createElement('td');
            scoreCell.className = 'col-score';
            scoreCell.textContent = p.score;
            
            // UNO Cell
            const unoCell = document.createElement('td');
            unoCell.className = 'col-uno';
            unoCell.textContent = p.unoState === 'declared' ? '✅' : '❌';
            
            // Action Cell (for Host)
            const actionCell = document.createElement('td');
            actionCell.className = 'col-action';
            if (me.isHost && p.playerId !== me.playerId && p.status === 'Active') {
                actionCell.innerHTML = `<button class="afk-btn danger-btn" data-player-id="${p.playerId}">AFK?</button>`;
                showActionColumn = true;
            }

            row.appendChild(nameCell);
            row.appendChild(cardsCell);
            row.appendChild(scoreCell);
            row.appendChild(unoCell);
            row.appendChild(actionCell);
            elements.playersTableBody.appendChild(row);
        });
        
        // Show/hide host action column
        elements.hostActionColHeader.style.display = showActionColumn ? '' : 'none';
        document.querySelectorAll('#players-table .col-action').forEach(cell => {
            cell.style.display = showActionColumn ? '' : 'none';
        });
    }

    function renderGameLog(logHistory) {
        elements.gameLogContent.innerHTML = logHistory.map(entry => `<div>${entry}</div>`).join('');
    }

    function renderWildSwapPlayerList() {
        elements.swapPlayerListUl.innerHTML = '';
        currentGameState.players.forEach(p => {
            if (p.playerId !== myPersistentPlayerId && p.status === 'Active') {
                const li = document.createElement('li');
                li.dataset.playerId = p.playerId;
                li.textContent = `${p.name} (${p.hand.length} cards)`;
                elements.swapPlayerListUl.appendChild(li);
            }
        });
    }

    function showRoundOverModal(data) {
        const { scoreboard, winnerName, roundNumber, hostId, finalHands } = data;
        const me = currentGameState.players.find(p => p.playerId === myPersistentPlayerId);

        elements.scoreboardTitle.textContent = `Round ${roundNumber} Complete!`;
        elements.scoreboardWinnerText.textContent = `🎉 ${winnerName} won the round! 🎉`;
        
        renderRoundScoreboardTable(scoreboard);
        
        // *** NEW: Render final hands ***
        renderFinalHands(finalHands, scoreboard);
        
        if (me && hostId === me.playerId) {
            elements.scoreboardNextRoundBtn.style.display = 'block';
            elements.scoreboardEndGameBtn.style.display = 'block';
            elements.scoreboardOkBtn.style.display = 'none';
        } else {
            elements.scoreboardNextRoundBtn.style.display = 'none';
            elements.scoreboardEndGameBtn.style.display = 'none';
            elements.scoreboardOkBtn.style.display = 'block';
        }
        elements.scoreboardModal.classList.remove('hidden');
    }

    function renderRoundScoreboardTable(scoreboardData) {
        let table = '<table>';
        table += '<tr><th>Player</th><th class="score-col">Round Score</th><th class="score-col">Total Score</th></tr>';
        
        scoreboardData.forEach(player => {
            table += `<tr>
                <td>${player.name}</td>
                <td class="score-col">${player.roundScore}</td>
                <td class="score-col">${player.cumulativeScore}</td>
            </tr>`;
        });
        
        table += '</table>';
        elements.scoreboardContent.innerHTML = table; // This will be overwritten if final hands are added
    }
    
    // *** NEW: Function to render final hands ***
    function renderFinalHands(finalHands, scoreboardData) {
        // First, re-render the scoreboard table
        renderRoundScoreboardTable(scoreboardData);
        
        // Now, append the final hands
        const container = elements.roundOverHands;
        container.innerHTML = ''; // Clear previous

        if (!finalHands || !scoreboardData) return;
        
        scoreboardData.forEach(scoreEntry => {
            const player = currentGameState.players.find(p => p.name === scoreEntry.name);
            if (!player) return;

            const hand = finalHands[player.playerId];
            const handDiv = document.createElement('div');
            handDiv.className = 'player-hand-display';

            const nameEl = document.createElement('div');
            nameEl.className = 'player-hand-name';
            nameEl.textContent = `${scoreEntry.name}:`;
            handDiv.appendChild(nameEl);

            const cardsContainer = document.createElement('div');
            cardsContainer.className = 'player-hand-cards';
            if (hand && hand.length > 0) {
                 // Sort the hand for display
                 hand.sort((a, b) => {
                    if (a.color < b.color) return -1;
                    if (a.color > b.color) return 1;
                    if (a.value < b.value) return -1;
                    if (a.value > b.value) return 1;
                    return 0;
                 });
                hand.forEach(card => {
                    cardsContainer.appendChild(createSmallCardImage(card));
                });
            } else {
                cardsContainer.textContent = '(Empty)';
            }
            handDiv.appendChild(cardsContainer);
            container.appendChild(handDiv);
        });
    }

    function renderGameOver(data) {
        const { scoreboard, winnerNames } = data;
        
        elements.gameOverTitle.textContent = 'Game Over!';
        
        if (winnerNames.length === 1) {
            elements.gameOverWinnerText.textContent = `${winnerNames[0]} wins the game!`;
        } else {
            elements.gameOverWinnerText.textContent = `Joint Winners: ${winnerNames.join(', ')}!`;
        }
        
        let table = '<table>';
        table += '<tr><th>Player</th><th class="score-col">Final Score</th></tr>';
        scoreboard.forEach(player => {
            table += `<tr>
                <td>${player.name}</td>
                <td class="score-col">${player.score}</td>
            </tr>`;
        });
        table += '</table>';
        
        elements.gameOverScoreboard.innerHTML = table;
        elements.gameOverModal.classList.remove('hidden');
    }

    // --- *** NEW: Status Banner Functions (Ported from SOH) *** ---
    function renderGameStatusBanner(gs, me) {
        const banner = elements.gameStatusBanner;
        if (!banner) return;

        if (gs.isPaused) {
            updatePauseBanner(gs); // This function will set its own interval
            return;
        }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        
        if (gs.currentPlayerId === null && !gs.isPaused) {
            banner.textContent = `Round ${gs.currentRound} Over. Waiting for host...`;
            return;
        }

        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId);
        if (!currentPlayer) {
            banner.textContent = "Waiting for game to start...";
            return;
        }

        let bannerText = "";
        if (gs.pendingAction) {
             const actionPlayer = gs.players.find(p => p.socketId === gs.pendingAction.playerSocketId);
             if (actionPlayer) {
                 bannerText = `Waiting for ${actionPlayer.name} to resolve an action...`;
             } else {
                 bannerText = "Waiting for player action...";
             }
        } else if (currentPlayer.playerId === me.playerId) {
            bannerText = `YOUR TURN. (Round ${gs.currentRound})`;
        } else {
            bannerText = `Waiting for ${currentPlayer.name}... (Round ${gs.currentRound})`;
        }

        banner.textContent = bannerText;
    }

    function updatePauseBanner(gs) {
        const banner = elements.gameStatusBanner;
        if (!banner) return;

        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);

        const updateText = () => {
            const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
            const bannerText = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;
            banner.innerHTML = bannerText;
            if (remaining === 0) {
                clearInterval(pauseCountdownInterval);
            }
        };
        updateText();
        pauseCountdownInterval = setInterval(updateText, 1000);
    }

    // --- *** NEW: Move Announcement (Toast) Functions (Ported from SOH) *** ---
    function handleMoveAnnouncement(currentState, prevState) {
        if (!prevState || !currentState || !currentState.logHistory || currentState.logHistory.length === 0) {
            return;
        }

        const latestLog = currentState.logHistory[0];
        const previousLog = prevState.logHistory[0];

        // Don't show if log hasn't changed or is a non-move
        if (latestLog === previousLog || latestLog.includes('Starting Round') || latestLog.includes('Winner:') || latestLog.includes('Game initialized.')) {
             return;
        }

        // *** CRITICAL: Anti-clash logic ***
        // Do not show a toast if a modal is about to appear.
        const modalLogs = ['played a Wild', 'played a Wild Draw Four', 'played a Wild Swap', 'played a Wild Pick Until'];
        if (modalLogs.some(logFragment => latestLog.includes(logFragment))) {
            return; // A modal is coming, so no toast.
        }

        let message = "";
        const nextPlayer = currentState.players.find(p => p.playerId === currentState.currentPlayerId);
        const nextPlayerName = nextPlayer ? nextPlayer.name : "Unknown";

        // Parse log for completed actions
        if (latestLog.includes('chose the color')) {
            // "Player A chose the color Red."
            const match = latestLog.match(/^(.+?) chose the color (.+?)\./);
            if (match) {
                 message = `${match[1]} chose ${match[2]}. Next: ${nextPlayerName}`;
            }
        } else if (latestLog.includes('played a')) {
            // "Player A played a Red 5."
            const match = latestLog.match(/^(.+?) played a (.+?)\./);
            if(match) {
                 message = `${match[1]} played ${match[2]}. Next: ${nextPlayerName}`;
            }
        } else if (latestLog.includes('drew a card')) {
            message = `${latestLog.replace('.', '')}. Next: ${nextPlayerName}`;
        } else if (latestLog.includes('drew and auto-played')) {
            const match = latestLog.match(/^(.+?) drew and auto-played a (.+?)\./);
            if (match) {
                 message = `${match[1]} auto-played ${match[2]}. Next: ${nextPlayerName}`;
            }
        } else if (latestLog.includes('penalized')) {
             message = `${latestLog.replace('.', '')}. Next: ${nextPlayerName}`;
        } else if (latestLog.includes('forgot to call UNO')) {
             message = `${latestLog.replace('.', '')}. Next: ${nextPlayerName}`;
        } else {
            // Fallback for other logs
             message = `${latestLog} | Next: ${nextPlayerName}`;
        }

        if (message) {
            showMoveAnnouncement(message);
        }
    }

    function showMoveAnnouncement(message) {
        const banner = elements.moveAnnouncementBanner;
        if (!banner) return;

        banner.textContent = message;
        banner.classList.add('visible');

        if (moveAnnouncementTimeout) {
            clearTimeout(moveAnnouncementTimeout);
        }

        moveAnnouncementTimeout = setTimeout(() => {
            banner.classList.remove('visible');
            moveAnnouncementTimeout = null;
        }, 3000); // Show for 3 seconds
    }

    // --- *** NEW: Winner Animation Functions (Ported from SOH) *** ---
    function showWinnerAnnouncement(mainText, subText, duration, callback) {
        const overlay = $('winner-announcement-overlay');
        const textElement = $('winner-announcement-text');
        const subtextElement = $('winner-announcement-subtext');

        if (!overlay || !textElement || !subtextElement) return;

        textElement.textContent = mainText;
        subtextElement.textContent = subText || '';
        overlay.classList.remove('hidden');
        startRainAnimation();

        setTimeout(() => {
            hideWinnerAnnouncement();
            if (callback) {
                callback();
            }
        }, duration);
    }

    function hideWinnerAnnouncement() {
         const overlay = $('winner-announcement-overlay');
         if (overlay) overlay.classList.add('hidden');
         stopRainAnimation();
    }

    function startRainAnimation() {
        const container = $('winner-animation-container');
        if (!container || rainInterval) return;

        const elements = ['⭐', '🌸', '✨', '🎉', '🌟', '❤️', '💚', '💙', '💛'];

        rainInterval = setInterval(() => {
            const rainElement = document.createElement('div');
            rainElement.classList.add('rain-element');
            rainElement.textContent = elements[Math.floor(Math.random() * elements.length)];
            rainElement.style.left = Math.random() * 100 + 'vw';
            rainElement.style.animationDuration = (Math.random() * 2 + 3) + 's';
            rainElement.style.fontSize = (Math.random() * 1 + 1) + 'em';

            container.appendChild(rainElement);

            setTimeout(() => {
                rainElement.remove();
            }, 5000);

        }, 100);
    }

    function stopRainAnimation() {
        const container = $('winner-animation-container');
        if (rainInterval) {
            clearInterval(rainInterval);
            rainInterval = null;
        }
        if (container) {
            container.innerHTML = '';
        }
    }


    // --- Helper Functions ---
    function getCardImagePath(card) {
        if (!card) return '/assets/cards/card_back.png';
        const color = card.color.toLowerCase();
        let value = card.value.toLowerCase();
        
        if (value.includes(' ')) {
            value = value.replace(' ', '_'); // e.g., "draw two" -> "draw_two"
        }
        
        return `/assets/cards/${color}_${value}.png`;
    }

    function createCardImage(card) {
        const img = document.createElement('img');
        img.src = getCardImagePath(card);
        img.alt = `${card.color} ${card.value}`;
        img.className = 'card-img';
        img.dataset.id = card.id;
        return img;
    }
    
    // *** NEW: Helper for small card images in scoreboard ***
    function createSmallCardImage(card) {
        const img = document.createElement('img');
        img.src = getCardImagePath(card);
        img.alt = `${card.color} ${card.value}`;
        img.className = 'final-card-img';
        img.dataset.id = card.id;
        return img;
    }

    function isPlayable(card, topCard, currentColor) {
        if (!topCard) return true; // Should not happen after first card
        if (card.color === 'Black') return true;
        if (card.color === currentColor) return true;
        if (card.value === topCard.value) return true;
        return false;
    }

    function showWarning(title, text) {
        elements.warningModalTitle.textContent = title;
        elements.warningModalText.textContent = text;
        elements.warningModal.classList.remove('hidden');
    }

    function hideAllActionModals() {
        elements.chooseColorModal.classList.add('hidden');
        elements.wildSwapModal.classList.add('hidden');
        elements.wildPickUntilModal.classList.add('hidden');
        elements.wildDrawChoiceModal.classList.add('hidden');
    }
    
    function forceDisconnect() {
        sessionStorage.removeItem('unoPlayerId');
        sessionStorage.removeItem('unoPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        socket.io.opts.query.playerId = null;
        location.reload();
    }

    function makeModalsDraggable() {
        document.querySelectorAll('.modal').forEach(modal => {
            const modalContent = modal.querySelector('.modal-content');
            const header = modal.querySelector('.modal-header');
            if (!header || !modalContent) return;

            let isDragging = false;
            let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

            const dragStart = (e) => {
                isDragging = true;
                const clientX = e.clientX || e.touches[0].clientX;
                const clientY = e.clientY || e.touches[0].clientY;
                
                startX = clientX;
                startY = clientY;
                
                const rect = modalContent.getBoundingClientRect();
                const parentRect = document.body.getBoundingClientRect();
                
                initialLeft = rect.left - parentRect.left;
                initialTop = rect.top - parentRect.top;
                
                // Set position to absolute to "pop" it out of flex centering
                modalContent.style.position = 'absolute';
                modalContent.style.left = `${initialLeft}px`;
                modalContent.style.top = `${initialTop}px`;
                modalContent.style.transform = 'none'; // Remove any centering transform

                document.addEventListener('mousemove', dragMove);
                document.addEventListener('mouseup', dragEnd);
                document.addEventListener('touchmove', dragMove, { passive: false });
                document.addEventListener('touchend', dragEnd);
            };

            const dragMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                
                const clientX = e.clientX || e.touches[0].clientX;
                const clientY = e.clientY || e.touches[0].clientY;

                const deltaX = clientX - startX;
                const deltaY = clientY - startY;

                modalContent.style.left = `${initialLeft + deltaX}px`;
                modalContent.style.top = `${initialTop + deltaY}px`;
            };

            const dragEnd = () => {
                isDragging = false;
                document.removeEventListener('mousemove', dragMove);
                document.removeEventListener('mouseup', dragEnd);
                document.removeEventListener('touchmove', dragMove);
                document.removeEventListener('touchend', dragEnd);
            };

            header.addEventListener('mousedown', dragStart);
            header.addEventListener('touchstart', dragStart, { passive: true });
        });
    }
});