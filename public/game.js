window.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Assuming server is on the same origin
    // const socket = io('https://gupte-family-uno-game.onrender.com'); // Use this for production

    let myPersistentPlayerId = sessionStorage.getItem('unoPlayerId');
    let isGameOver = false;
    let countdownInterval = null;
    let playerIdToMarkAFK = null; // *** NEW: For AFK confirmation

    // --- SCREEN & ELEMENT REFERENCES ---
    const joinScreen = document.getElementById('join-screen');
    const lobbyScreen = document.getElementById('lobby-screen');
    const gameBoard = document.getElementById('game-board');
    const playerNameInput = document.getElementById('player-name-input');
    const joinGameBtn = document.getElementById('join-game-btn');
    const playerList = document.getElementById('player-list');
    const startGameBtn = document.getElementById('start-game-btn');
    const hostMessage = document.getElementById('host-message');
    const drawCardBtn = document.getElementById('drawCardBtn');
    const unoBtn = document.getElementById('unoBtn');
    const colorPickerModal = document.getElementById('color-picker-modal');
    const drawnWildModal = document.getElementById('drawn-wild-modal');
    const pickUntilModal = document.getElementById('pick-until-modal');
    const swapModal = document.getElementById('swap-modal');
    const endGameBtn = document.getElementById('endGameBtn');
    const endOfRoundDiv = document.getElementById('end-of-round-div');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const endGameRoundBtn = document.getElementById('end-game-round-btn');
    const dealChoiceModal = document.getElementById('deal-choice-modal');
    const dealCardsInput = document.getElementById('deal-cards-input');
    const dealCardsBtn = document.getElementById('deal-cards-btn');
    const unoAnnouncementOverlay = document.getElementById('uno-announcement-overlay');
    const unoAnnouncementText = document.getElementById('uno-announcement-text');
    const confirmEndGameModal = document.getElementById('confirm-end-game-modal');
    const confirmEndYesBtn = document.getElementById('confirm-end-yes-btn');
    const confirmEndNoBtn = document.getElementById('confirm-end-no-btn');
    const finalScoreModal = document.getElementById('final-score-modal');
    const finalWinnerMessage = document.getElementById('final-winner-message');
    const finalScoreTableContainer = document.getElementById('final-score-table-container');
    const finalScoreOkBtn = document.getElementById('final-score-ok-btn');
    const invalidMoveCallout = document.getElementById('invalid-move-callout');
    const gameLogList = document.getElementById('game-log-list');
    const toastNotification = document.getElementById('toast-notification');
    const actionBar = document.getElementById('action-bar');
    const arrangeHandBtn = document.getElementById('arrangeHandBtn');
    const hostRoundEndControls = document.getElementById('host-round-end-controls');
    const nextRoundOkBtn = document.getElementById('next-round-ok-btn');
    
    // *** AFK Modal References ***
    const afkNotificationModal = document.getElementById('afk-notification-modal');
    const imBackBtn = document.getElementById('im-back-btn');

    // *** Discard Pile References ***
    const showDiscardPileBtn = document.getElementById('showDiscardPileBtn');
    const discardPileModal = document.getElementById('discard-pile-modal');
    const discardPileList = document.getElementById('discard-pile-list');
    const discardPileOkBtn = document.getElementById('discard-pile-ok-btn'); // *** NEW ***

    // *** NEW: Confirm AFK Modal References ***
    const confirmAfkModal = document.getElementById('confirm-afk-modal');
    const confirmAfkPlayerName = document.getElementById('confirm-afk-player-name');
    const confirmAfkYesBtn = document.getElementById('confirm-afk-yes-btn');
    const confirmAfkNoBtn = document.getElementById('confirm-afk-no-btn');


    joinScreen.style.display = 'block';
    lobbyScreen.style.display = 'none';
    gameBoard.style.display = 'none';

    // --- DRAG AND DROP GLOBALS ---
    let draggedCardElement = null;
    let draggedCardIndex = -1;

    // --- EVENT LISTENERS (Sending messages to server) ---

    joinGameBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        if (playerName) {
            socket.emit('joinGame', { playerName, playerId: myPersistentPlayerId });
        } else {
            alert('Please enter your name.');
        }
    });

    // *** Lobby Kick Button Listener ***
    playerList.addEventListener('click', (event) => {
        if (event.target.classList.contains('kick-btn')) {
            const playerIdToKick = event.target.dataset.playerId;
            socket.emit('kickPlayer', { playerIdToKick });
        }
    });

    // *** MODIFIED: In-Game AFK Button Listener (Shows Confirmation) ***
    document.getElementById('left-column').addEventListener('click', (event) => {
        if (event.target.classList.contains('mark-afk-btn')) {
            playerIdToMarkAFK = event.target.dataset.playerId; // Store the ID
            // Find player name to show in modal
            const player = window.gameState?.players.find(p => p.playerId === playerIdToMarkAFK);
            if (player) {
                confirmAfkPlayerName.textContent = player.name;
                confirmAfkModal.style.display = 'flex';
            }
        }
    });

    // *** NEW: AFK Confirmation Listeners ***
    confirmAfkYesBtn.addEventListener('click', () => {
        if (playerIdToMarkAFK) {
            socket.emit('markPlayerAFK', { playerIdToMark: playerIdToMarkAFK });
        }
        confirmAfkModal.style.display = 'none';
        playerIdToMarkAFK = null; // Clear stored ID
    });

    confirmAfkNoBtn.addEventListener('click', () => {
        confirmAfkModal.style.display = 'none';
        playerIdToMarkAFK = null; // Clear stored ID
    });


    // *** "I'm Back" Button Listener ***
    imBackBtn.addEventListener('click', () => {
        socket.emit('playerIsBack');
        afkNotificationModal.style.display = 'none';
    });


    startGameBtn.addEventListener('click', () => { socket.emit('startGame'); });
    drawCardBtn.addEventListener('click', () => { socket.emit('drawCard'); });

    endGameBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'flex'; });
    endGameRoundBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'flex'; });
    confirmEndNoBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'none'; });
    confirmEndYesBtn.addEventListener('click', () => {
        confirmEndGameModal.style.display = 'none';
        socket.emit('endGame');
    });

    finalScoreOkBtn.addEventListener('click', () => {
        isGameOver = false;
        finalScoreModal.style.display = 'none';
        gameBoard.style.display = 'none';
        lobbyScreen.style.display = 'none';
        joinScreen.style.display = 'block';
        sessionStorage.clear();
        myPersistentPlayerId = null;
    });


    unoBtn.addEventListener('click', () => {
        socket.emit('callUno');
        unoBtn.classList.add('pressed');
        setTimeout(() => unoBtn.classList.remove('pressed'), 300);
    });

    nextRoundBtn.addEventListener('click', () => {
        socket.emit('playerReadyForNextRound');
        nextRoundBtn.disabled = true;
        nextRoundBtn.textContent = 'Waiting...';
    });

    nextRoundOkBtn.addEventListener('click', () => {
        socket.emit('playerReadyForNextRound');
        endOfRoundDiv.style.display = 'none';
    });


    dealCardsBtn.addEventListener('click', () => {
        const numCards = dealCardsInput.value;
        socket.emit('dealChoice', { numCards });
    });

    colorPickerModal.addEventListener('click', (event) => {
        if (event.target.matches('.color-btn')) {
            const color = event.target.dataset.color;
            socket.emit('colorChosen', { color });
        }
    });

    drawnWildModal.addEventListener('click', (event) => {
        const cardIndex = parseInt(drawnWildModal.dataset.cardIndex);
        if (event.target.id === 'option-play-wild') {
            socket.emit('choosePlayDrawnWild', { play: true, cardIndex });
        } else if (event.target.id === 'option-keep-wild') {
            socket.emit('choosePlayDrawnWild', { play: false, cardIndex });
        }
        drawnWildModal.style.display = 'none';
    });

    pickUntilModal.addEventListener('click', (event) => {
        let choice = null;
        if (event.target.id === 'option-pick-color') {
            choice = 'pick-color';
        } else if (event.target.id === 'option-discard-wilds') {
            choice = 'discard-wilds';
        }
        if (choice) {
            socket.emit('pickUntilChoice', { choice });
        }
        pickUntilModal.style.display = 'none';
    });

    swapModal.addEventListener('click', (event) => {
        if (event.target.matches('.player-swap-btn')) {
            const targetPlayerId = event.target.dataset.playerId;
            socket.emit('swapHandsChoice', { targetPlayerId });
            swapModal.style.display = 'none';
        }
    });

    arrangeHandBtn.addEventListener('click', () => {
        const myPlayer = window.gameState?.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) return;

        const colorOrder = { 'Black': 0, 'Blue': 1, 'Green': 2, 'Red': 3, 'Yellow': 4 };
        const valueOrder = {
            'Draw Two': 12, 'Skip': 11, 'Reverse': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2, '1': 1, '0': 0,
            'Wild': -1, 'Wild Draw Four': -1, 'Wild Pick Until': -1, 'Wild Swap': -1
        };

        const sortedHand = [...myPlayer.hand].sort((a, b) => {
            const colorComparison = colorOrder[a.color] - colorOrder[b.color];
            if (colorComparison !== 0) {
                return colorComparison;
            }
            return valueOrder[b.value] - valueOrder[a.value];
        });

        myPlayer.hand = sortedHand;
        socket.emit('rearrangeHand', { newHand: sortedHand });
        displayGame(window.gameState);
    });

    // *** Discard Pile Modal Show Listener ***
    showDiscardPileBtn.addEventListener('click', () => {
        if (!window.gameState) return;
        
        const lastTenDiscards = window.gameState.discardPile.slice(0, 10);
        discardPileList.innerHTML = ''; // Clear previous list

        if (lastTenDiscards.length === 0) {
            discardPileList.innerHTML = '<p>The discard pile is empty.</p>';
        } else {
            lastTenDiscards.forEach(item => {
                const discardItemDiv = document.createElement('div');
                discardItemDiv.className = 'discard-item';

                const playerP = document.createElement('p');
                playerP.className = 'discard-item-player';
                playerP.textContent = `Played by: ${item.playerName}`;
                
                // Ensure item.card exists before creating element
                if (item.card) {
                    const cardEl = createCardElement(item.card, -1);
                    discardItemDiv.appendChild(cardEl);
                    discardItemDiv.appendChild(playerP);
                    discardPileList.appendChild(discardItemDiv);
                } else {
                    console.warn("Discard pile item missing card data:", item);
                }
            });
        }
        discardPileModal.style.display = 'flex';
    });

    // *** NEW: Discard Pile Modal OK Listener ***
    discardPileOkBtn.addEventListener('click', () => {
        discardPileModal.style.display = 'none';
    });


    // --- EVENT LISTENERS (Receiving messages from server) ---

    socket.on('connect', () => {
        console.log('Socket connected with ID:', socket.id);
        if (myPersistentPlayerId) {
            console.log('Attempting to rejoin with existing ID:', myPersistentPlayerId);
            
            // --- MODIFIED LOGIC (FIX) ---
            // Get the name from session storage.
            const savedName = sessionStorage.getItem('unoPlayerName');
            const playerName = savedName || playerNameInput.value.trim() || "Player";
            
            // Pre-fill the input box with the saved name for consistency
            if (savedName) {
                playerNameInput.value = savedName;
            }
            // --- END OF MODIFIED LOGIC ---

            socket.emit('joinGame', { playerName, playerId: myPersistentPlayerId });
        }
    });

    socket.on('joinSuccess', ({ playerId, lobby }) => {
        console.log('Successfully joined/registered with ID:', playerId);
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('unoPlayerId', playerId);

        // --- NEW LOGIC (FIX) ---
        // Find our own player object in the lobby list to get the confirmed name
        const me = lobby.find(p => p.playerId === playerId);
        if (me) {
            sessionStorage.setItem('unoPlayerName', me.name);
            // Also, update the input box in case the user is sitting on the join screen
            playerNameInput.value = me.name;
        }
        // --- END OF NEW LOGIC ---

        renderLobby(lobby);
    });

    socket.on('lobbyUpdate', (players) => {
        console.log('Received lobbyUpdate from server.');
        if (isGameOver) return;
        renderLobby(players);
    });

    socket.on('updateGameState', (gameState) => {
        if (gameState.roundOver) {
            // Don't show board yet, wait for 'roundOver' event
            displayGame(gameState);
        } else {
            joinScreen.style.display = 'none';
            lobbyScreen.style.display = 'none';
            endOfRoundDiv.style.display = 'none';
            gameBoard.style.display = 'flex';
            displayGame(gameState);
        }
    });

    // *** Winner Announcement Listener ***
    socket.on('announceRoundWinner', ({ winnerNames }) => {
        let message = `${winnerNames} wins the round!`;
        if (winnerNames.includes(' and ')) {
            message = `${winnerNames} win the round!`;
        }
        showUnoAnnouncement(message);
    });

    // *** Delayed Scoreboard ***
    socket.on('roundOver', ({ winnerName, scores, finalGameState }) => {
        // Wait for the announcement to finish
        setTimeout(() => {
            displayGame(finalGameState); // Refresh state

            document.getElementById('winner-message').textContent = `${winnerName} win(s) the round!`;

            const scoresDisplay = document.getElementById('scores-display');
            scoresDisplay.innerHTML = '<h3>Round Scores</h3>';
            const scoreTable = document.createElement('table');
            scoreTable.className = 'score-table';

            let tableHTML = '<thead><tr><th>Player</th><th>Hand Score</th><th>Total Score</th></tr></thead><tbody>';

            finalGameState.players.sort((a,b) => a.score - b.score).forEach(p => {
                const roundScoreForPlayer = p.scoresByRound[p.scoresByRound.length - 1];
                const isWinner = winnerName.includes(p.name);
                tableHTML += `<tr class="${isWinner ? 'winner-row' : ''}"><td>${p.name}</td><td>${roundScoreForPlayer}</td><td>${p.score}</td></tr>`;
            });
            tableHTML += '</tbody>';
            scoreTable.innerHTML = tableHTML;
            scoresDisplay.appendChild(scoreTable);

            const myPlayer = finalGameState.players.find(p => p.playerId === myPersistentPlayerId);

            if (myPlayer && myPlayer.isHost) {
                hostRoundEndControls.style.display = 'flex';
                nextRoundOkBtn.style.display = 'none';
                nextRoundBtn.disabled = false;
                nextRoundBtn.textContent = 'Start Next Round';
            } else {
                hostRoundEndControls.style.display = 'none';
                nextRoundOkBtn.style.display = 'block';
            }

            endOfRoundDiv.style.display = 'flex';
        }, 2000); // 2-second delay
    });

    socket.on('finalGameOver', (finalGameState) => {
        isGameOver = true;
        gameBoard.style.display = 'none';
        endOfRoundDiv.style.display = 'none';
        renderFinalScores(finalGameState);
        finalScoreModal.style.display = 'flex';
    });


    socket.on('drawnWildCard', ({ cardIndex, drawnCard }) => {
        if (window.gameState) {
            const myPlayer = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
            if (myPlayer) {
                myPlayer.hand.push(drawnCard);
                displayGame(window.gameState);
            }
        }
        drawnWildModal.dataset.cardIndex = cardIndex;
        drawnWildModal.style.display = 'flex';
    });

    socket.on('announce', (message) => {
        showToast(message);
    });

    socket.on('youWereMarkedAFK', () => {
        afkNotificationModal.style.display = 'flex';
    });

    socket.on('playerDisconnected', ({ playerName }) => {
        // Handled by log
    });
    socket.on('playerReconnected', ({ playerName }) => {
        // Handled by log
    });

    socket.on('unoCalled', ({ playerName }) => {
        showUnoAnnouncement(`${playerName} says UNO!`);
    });

    socket.on('gameLog', (message) => {
        addMessageToGameLog(message);
    });

    socket.on('animateDraw', ({ playerId, count }) => {
        animateCardDraw(playerId, count);
    });

    socket.on('animateSwap', ({ p1_id, p2_id }) => {
        animateHandSwap(p1_id, p2_id);
    });

    socket.on('animatePlay', ({ playerId, card, cardIndex }) => {
        animateCardPlay(playerId, card, cardIndex);
    });


    // --- ALL DISPLAY AND HELPER FUNCTIONS ---

    function renderLobby(players) {
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
            showToast("You have been kicked from the lobby.");
            sessionStorage.clear();
            myPersistentPlayerId = null;
            setTimeout(() => {
                location.reload();
            }, 1500);
            return;
        }

        joinScreen.style.display = 'none';
        lobbyScreen.style.display = 'block';
        gameBoard.style.display = 'none';
        endOfRoundDiv.style.display = 'none';
        finalScoreModal.style.display = 'none';

        playerList.innerHTML = '';
        if (gameLogList) gameLogList.innerHTML = '';
        
        let amIHost = me.isHost; 

        players.forEach(player => {
            const playerItem = document.createElement('li');
            
            const nameSpan = document.createElement('span');
            let content = player.name;
            if (player.isHost) { content += ' 👑 (Host)'; }
            if (player.playerId === myPersistentPlayerId) {
                content += ' (You)';
            }
            nameSpan.textContent = content;
            playerItem.appendChild(nameSpan);
            
            if (amIHost && player.playerId !== myPersistentPlayerId) {
                const kickBtn = document.createElement('button');
                kickBtn.className = 'kick-btn';
                kickBtn.textContent = 'Kick';
                kickBtn.dataset.playerId = player.playerId;
                playerItem.appendChild(kickBtn);
            }

            playerList.appendChild(playerItem);
        });

        if (amIHost && players.length >= 2) {
            startGameBtn.style.display = 'block';
        } else {
            startGameBtn.style.display = 'none';
        }
        hostMessage.style.display = amIHost ? 'none' : 'block';
    }


    function showToast(message) {
        if (!toastNotification) return;
        toastNotification.textContent = message;
        toastNotification.classList.add('show');
        setTimeout(() => {
            toastNotification.classList.remove('show');
        }, 3000);
    }

    function showUnoAnnouncement(message) {
        unoAnnouncementText.textContent = message;
        if (message.length > 10) {
            unoAnnouncementText.style.fontSize = '8vw';
        } else {
            unoAnnouncementText.style.fontSize = '15vw';
        }
        unoAnnouncementOverlay.classList.add('show');
        setTimeout(() => {
            unoAnnouncementOverlay.classList.remove('show');
        }, 1900); 
    }

    function isClientMoveValid(playedCard, gameState) {
        if (!gameState || !gameState.discardPile || gameState.discardPile.length === 0) return false;
        const topDiscard = gameState.discardPile[0]; // Get the discard object
        if (!topDiscard || !topDiscard.card) return false; // Safety check
        const topCard = topDiscard.card; // Get the card from the object
        const activeColor = gameState.activeColor;
        const drawPenalty = gameState.drawPenalty;

        if (drawPenalty > 0) {
            return playedCard.value === topCard.value;
        }

        if (playedCard.color === 'Black') return true;
        if (playedCard.color === activeColor || playedCard.value === topCard.value) return true;
        return false;
    }

    function triggerInvalidMoveFeedback(cardElement) {
        cardElement.classList.add('invalid-shake');
        const cardRect = cardElement.getBoundingClientRect();
        const boardRect = gameBoard.getBoundingClientRect();
        invalidMoveCallout.style.top = `${cardRect.top - boardRect.top - 40}px`;
        invalidMoveCallout.style.left = `${cardRect.left - boardRect.left + (cardRect.width / 2) - (invalidMoveCallout.offsetWidth / 2)}px`;
        invalidMoveCallout.classList.add('show');
        setTimeout(() => {
            cardElement.classList.remove('invalid-shake');
        }, 500);
        setTimeout(() => {
            invalidMoveCallout.classList.remove('show');
        }, 1500);
    }

    function animateCardPlay(playerId, card, cardIndex) {
        const discardPileEl = document.querySelector('#discard-pile-dropzone .card');
        const playerAreaEl = document.querySelector(`[data-player-id="${playerId}"]`);
        if (!discardPileEl || !playerAreaEl) return;

        const startRect = playerAreaEl.getBoundingClientRect();
        const endRect = discardPileEl.getBoundingClientRect();
        const boardRect = gameBoard.getBoundingClientRect();

        const clone = createCardElement(card, -1);
        clone.classList.add('flying-card');

        clone.style.top = `${startRect.top - boardRect.top + (startRect.height / 2) - 60}px`;
        clone.style.left = `${startRect.left - boardRect.left + (startRect.width / 2) - 40}px`;
        clone.style.width = '80px';
        clone.style.height = '120px';

        if (playerId === myPersistentPlayerId && window.gameState) {
             const myPlayer = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
             if (myPlayer) {
                const cardToHide = playerAreaEl.querySelector(`.card[data-card-index="${cardIndex}"]`);
                if(cardToHide) cardToHide.style.visibility = 'hidden';
             }
        }

        gameBoard.appendChild(clone);

        requestAnimationFrame(() => {
            clone.style.top = `${endRect.top - boardRect.top}px`;
            clone.style.left = `${endRect.left - boardRect.left}px`;
            clone.style.transform = `rotate(360deg)`;
            clone.style.width = `${endRect.width}px`;
            clone.style.height = `${endRect.height}px`;
        });

        setTimeout(() => {
            clone.remove();
        }, 800);
    }

    function animateCardDraw(playerId, count) {
        const drawPileEl = document.querySelector('.piles-container .card-back');
        const playerAreaEl = document.querySelector(`[data-player-id="${playerId}"] .card-container`);
        if (!drawPileEl || !playerAreaEl) return;

        const startRect = drawPileEl.getBoundingClientRect();
        const endRect = playerAreaEl.getBoundingClientRect();
        const boardRect = gameBoard.getBoundingClientRect();
        const smallCardWidth = 80;
        const scaleFactor = smallCardWidth / startRect.width;

        for (let i = 0; i < count; i++) {
            const cardBack = document.createElement('div');
            cardBack.className = 'card card-back flying-card';

            cardBack.style.top = `${startRect.top - boardRect.top}px`;
            cardBack.style.left = `${startRect.left - boardRect.top}px`; // Corrected: Use boardRect.top
            cardBack.style.width = `${startRect.width}px`; // Set initial size
            cardBack.style.height = `${startRect.height}px`;
            cardBack.style.transform = 'scale(1.2)';
            gameBoard.appendChild(cardBack);

            setTimeout(() => {
                requestAnimationFrame(() => {
                    const top = `${endRect.top - boardRect.top + 10}px`;
                    // Stagger cards slightly horizontally in the player's hand area
                    const left = `${endRect.left - boardRect.left + (i * (smallCardWidth / 4))}px`;
                    cardBack.style.transform = `scale(${scaleFactor})`;
                    cardBack.style.top = top;
                    cardBack.style.left = left;
                    cardBack.style.width = `${smallCardWidth}px`; // Final size
                    cardBack.style.height = `${smallCardWidth * 1.5}px`; // Maintain aspect ratio
                });
            }, i * 100 + 50); // Add slight delay before starting animation

            setTimeout(() => {
                cardBack.remove();
            }, 800 + (i * 100));
        }
    }

    function animateHandSwap(p1_id, p2_id) {
        const p1_area = document.querySelector(`[data-player-id="${p1_id}"]`);
        const p2_area = document.querySelector(`[data-player-id="${p2_id}"]`);
        if (!p1_area || !p2_area) return;

        const p1_cards = p1_area.querySelectorAll('.card-container .card');
        const p2_cards = p2_area.querySelectorAll('.card-container .card');
        const boardRect = gameBoard.getBoundingClientRect();

        const animateHand = (cards, toArea) => {
            const endRect = toArea.querySelector('.card-container').getBoundingClientRect();
            const clones = [];

            cards.forEach(card => {
                const startRect = card.getBoundingClientRect();
                const clone = card.cloneNode(true);
                clone.classList.add('flying-card');
                clone.style.top = `${startRect.top - boardRect.top}px`;
                clone.style.left = `${startRect.left - boardRect.left}px`;
                gameBoard.appendChild(clone);
                clones.push(clone);
                card.style.visibility = 'hidden';
            });

            clones.forEach((clone, i) => {
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        const top = `${endRect.top - boardRect.top + 10}px`;
                        const left = `${endRect.left - boardRect.left + (i * 20)}px`;
                        clone.style.top = top;
                        clone.style.left = left;
                    });
                }, i * 50);
                 setTimeout(() => clone.remove(), 800 + (i*50));
            });
        };

        animateHand(p1_cards, p2_area);
        animateHand(p2_cards, p1_area);
    }

    function addMessageToGameLog(message) {
        if (!gameLogList) return;

        const li = document.createElement('li');
        li.textContent = message;
        gameLogList.prepend(li);

        while (gameLogList.children.length > 8) {
            gameLogList.lastChild.remove();
        }
    }


    function renderFinalScores(finalGameState) {
        const players = finalGameState.players;
        const numRounds = finalGameState.roundNumber;
        const table = document.createElement('table');
        table.className = 'score-table final-table';

        let headerHtml = '<thead><tr><th>Round</th>';
        players.forEach(p => { headerHtml += `<th>${p.name}</th>`; });
        headerHtml += '</tr></thead>';

        let bodyHtml = '<tbody>';
        for (let i = 0; i < numRounds; i++) {
            bodyHtml += `<tr><td>${i + 1}</td>`;
            players.forEach(p => {
                const score = p.scoresByRound[i] !== undefined ? p.scoresByRound[i] : '-';
                bodyHtml += `<td>${score}</td>`;
            });
            bodyHtml += '</tr>';
        }
        bodyHtml += '</tbody>';

        let footerHtml = '<tfoot><tr><td><strong>Total</strong></td>';
        let lowestScore = Infinity;
        players.forEach(p => {
            // Only consider active/disconnected players for winning score
            if (p.status === 'Active' || p.status === 'Disconnected') {
                if (p.score < lowestScore) {
                    lowestScore = p.score;
                }
            }
            footerHtml += `<td><strong>${p.score}</strong></td>`;
        });
        footerHtml += '</tr></tfoot>';

        table.innerHTML = headerHtml + bodyHtml + footerHtml;
        finalScoreTableContainer.innerHTML = '';
        finalScoreTableContainer.appendChild(table);

        const winners = players.filter(p => (p.status === 'Active' || p.status === 'Disconnected') && p.score === lowestScore);
        const winnerNames = winners.map(w => w.name).join(' and ');
        finalWinnerMessage.textContent = `${winnerNames} win(s) the game!`;
    }


    function createCardElement(card, cardIndex) {
        const cardDiv = document.createElement('div');
        // Safety check for card data
        if (!card || !card.color || !card.value) {
            console.error("Attempted to create card element with invalid data:", card);
            cardDiv.className = 'card Black'; // Default fallback
            cardDiv.textContent = '?';
            return cardDiv;
        }

        cardDiv.className = `card ${card.color}`;
        cardDiv.dataset.cardIndex = cardIndex;

        if (!isNaN(card.value)) {
            const numberSpan = document.createElement('span');
            numberSpan.className = 'number-circle';
            numberSpan.textContent = card.value;
            cardDiv.appendChild(numberSpan);
        } else {
            const actionSpan = document.createElement('span');
            actionSpan.className = 'action-text';
            actionSpan.innerHTML = card.value.replace(/\s/g, '<br>');
            cardDiv.appendChild(actionSpan);
        }
        return cardDiv;
    }

    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('.modal-content h3, .modal-content h2, .modal-content p');

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function touchDown(e) {
            // Prevent default touch behavior like scrolling
            // e.preventDefault(); // Commented out - might prevent scrolling inside modal if needed
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
            document.ontouchend = closeDragElement;
            document.ontouchmove = elementTouchDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            // Ensure modal stays within viewport boundaries (optional, basic example)
            let newTop = element.offsetTop - pos2;
            let newLeft = element.offsetLeft - pos1;
            // newTop = Math.max(0, Math.min(newTop, window.innerHeight - element.offsetHeight));
            // newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - element.offsetWidth));
            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";
        }

        function elementTouchDrag(e) {
            // Prevent default touch behavior like scrolling while dragging
             e.preventDefault();
            pos1 = pos3 - e.touches[0].clientX;
            pos2 = pos4 - e.touches[0].clientY;
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
            let newTop = element.offsetTop - pos2;
            let newLeft = element.offsetLeft - pos1;
            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            document.ontouchend = null;
            document.ontouchmove = null;
        }

        if (header) {
            header.style.cursor = 'move'; // Add visual cue
            header.onmousedown = dragMouseDown;
            header.ontouchstart = touchDown;
        } else {
             // If no specific header, make the whole modal content draggable (less ideal)
             const content = element.querySelector('.modal-content');
             if (content) {
                content.style.cursor = 'move';
                content.onmousedown = dragMouseDown;
                content.ontouchstart = touchDown;
             }
        }
    }


    function displayGame(gameState) {
        window.gameState = gameState;

        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        renderPlayers(gameState);
        renderPiles(gameState);

        const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) {
            showToast("You have been removed from the game.");
            sessionStorage.clear();
            setTimeout(() => location.reload(), 1500);
            return;
        }

        const isMyTurn = myPlayer && gameState.players[gameState.currentPlayerIndex]?.playerId === myPlayer.playerId;
        const isPaused = gameState.isPaused;
        const isHost = myPlayer.isHost;

        endGameBtn.style.display = (isHost && !gameState.roundOver) ? 'block' : 'none';

        if (actionBar) {
            if (isPaused && gameState.pauseInfo && gameState.pauseInfo.pauseEndTime) {
                const { pauseEndTime, pausedForPlayerNames } = gameState.pauseInfo;
                const names = pausedForPlayerNames.join(', ');

                const updateTimer = () => {
                    const remaining = Math.max(0, Math.floor((pauseEndTime - Date.now()) / 1000));
                    actionBar.textContent = `Waiting ${remaining}s for ${names} to rejoin...`;
                };
                updateTimer();
                countdownInterval = setInterval(updateTimer, 1000);

            } else if (gameState.roundOver) {
                const host = gameState.players.find(p => p.isHost);
                const hostIsReady = gameState.readyForNextRound.includes(host?.playerId);
                const connectedPlayers = gameState.players.filter(p => p.status === 'Active');
                const allReady = gameState.readyForNextRound.length === connectedPlayers.length;

                if (hostIsReady && !allReady) {
                    const waitingOnPlayers = connectedPlayers.filter(p => !gameState.readyForNextRound.includes(p.playerId));
                    const waitingOnNames = waitingOnPlayers.map(p => p.name).join(', ');
                    actionBar.textContent = `Waiting for ${waitingOnNames} to click OK...`;
                } else {
                    actionBar.textContent = `Round Over! Waiting for players to start the next round.`;
                }

            } else if (gameState.needsDealChoice) {
                const dealer = gameState.players.find(p => p.playerId === gameState.needsDealChoice);
                actionBar.textContent = dealer ? `Waiting for ${dealer.name} to deal...` : 'Waiting for dealer...';
            } else if (gameState.needsColorChoice) {
                const chooser = gameState.players.find(p => p.playerId === gameState.needsColorChoice);
                actionBar.textContent = chooser ? `${chooser.name} is choosing a color...` : 'Choosing a color...';
            } else if (gameState.currentPlayerIndex !== undefined && gameState.players[gameState.currentPlayerIndex]) {
                const currentPlayer = gameState.players[gameState.currentPlayerIndex];
                if (currentPlayer.status === 'Active') {
                    actionBar.textContent = `Waiting for ${currentPlayer.name} to play...`;
                } else {
                    actionBar.textContent = `Waiting for ${currentPlayer.name} to reconnect...`;
                }
            } else {
                actionBar.textContent = "Game is starting...";
            }
        }

        if (gameState.roundOver && !gameState.readyForNextRound.includes(myPlayer.playerId)) {
            // Handled by socket.on('roundOver')
        } else if (!gameState.roundOver) {
            endOfRoundDiv.style.display = 'none';
        }


        if (unoBtn) {
            if (gameState.activeColor && gameState.activeColor !== 'Black') {
                const colorMap = { "Red": "#ff5555", "Green": "#55aa55", "Blue": "#5555ff", "Yellow": "#ffaa00" };
                unoBtn.style.backgroundColor = colorMap[gameState.activeColor];
            } else {
                unoBtn.style.backgroundColor = '#333';
            }
            if (myPlayer && myPlayer.hand.length === 2 && !isPaused && !gameState.roundOver) {
                unoBtn.disabled = false;
                unoBtn.classList.add('uno-ready');
            } else {
                unoBtn.disabled = true;
                unoBtn.classList.remove('uno-ready');
            }
        }

        if (drawCardBtn) {
            const currentPlayer = gameState.players[gameState.currentPlayerIndex];
            if (currentPlayer) {
                const pickUntilInfo = gameState.pickUntilState;
                const isPickUntilActive = pickUntilInfo?.active && pickUntilInfo.targetPlayerIndex === gameState.currentPlayerIndex;

                if (isPickUntilActive) {
                    drawCardBtn.textContent = `${currentPlayer.name} PICKS FOR ${pickUntilInfo.targetColor.toUpperCase()}`;
                } else if (gameState.drawPenalty > 0) {
                    drawCardBtn.textContent = `${currentPlayer.name} DRAWS ${gameState.drawPenalty}`;
                } else {
                    drawCardBtn.textContent = 'DRAW CARD';
                }

                drawCardBtn.disabled = !isMyTurn || isPaused || gameState.roundOver;
            } else {
                 drawCardBtn.textContent = 'DRAW CARD';
                 drawCardBtn.disabled = true;
            }
        }

        colorPickerModal.style.display = (gameState.needsColorChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';
        pickUntilModal.style.display = (gameState.needsPickUntilChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';
        dealChoiceModal.style.display = (gameState.needsDealChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';

        if (gameState.needsSwapChoice === myPersistentPlayerId && !isPaused) {
            const swapOptions = document.getElementById('swap-player-options');
            swapOptions.innerHTML = '';
            gameState.players.forEach(player => {
                if (player.playerId !== myPersistentPlayerId && player.status === 'Active') {
                    const button = document.createElement('button');
                    button.textContent = player.name;
                    button.className = 'player-swap-btn';
                    button.dataset.playerId = player.playerId;
                    swapOptions.appendChild(button);
                }
            });
            swapModal.style.display = 'flex';
        } else {
            swapModal.style.display = 'none';
        }
    }

    function renderPiles(gameState) {
        const pilesArea = document.getElementById('piles-area');
        pilesArea.innerHTML = '';
        const pilesContainer = document.createElement('div');
        pilesContainer.className = 'piles-container';
        const drawPileWrapper = document.createElement('div');
        drawPileWrapper.className = 'pile-wrapper';
        const drawPileTitle = document.createElement('h4');
        drawPileTitle.textContent = 'Draw Pile';
        const drawCount = document.createElement('div');
        drawCount.className = 'pile-count';
        drawCount.textContent = `(${gameState.drawPile.length} Cards)`;
        const cardBackElement = document.createElement('div');
        cardBackElement.className = 'card card-back';
        cardBackElement.innerHTML = 'U<br>N<br>O';
        drawPileWrapper.appendChild(drawPileTitle);
        drawPileWrapper.appendChild(drawCount);
        drawPileWrapper.appendChild(cardBackElement);
        const discardPileWrapper = document.createElement('div');
        discardPileWrapper.className = 'pile-wrapper';
        const discardPileTitle = document.createElement('h4');
        discardPileTitle.textContent = 'Discard Pile';
        const discardCount = document.createElement('div');
        discardCount.className = 'pile-count';
        discardCount.textContent = `(${gameState.discardPile.length} Cards)`;
        const discardPileDiv = document.createElement('div');
        discardPileDiv.id = 'discard-pile-dropzone';

        const topDiscard = gameState.discardPile[0];
        if (topDiscard && topDiscard.card) { // Safety check
            const topCardElement = createCardElement(topDiscard.card, -1);
            discardPileDiv.appendChild(topCardElement);
        }

        discardPileWrapper.appendChild(discardPileTitle);
        discardPileWrapper.appendChild(discardCount);
        discardPileWrapper.appendChild(discardPileDiv);
        pilesContainer.appendChild(drawPileWrapper);
        pilesContainer.appendChild(discardPileWrapper);
        pilesArea.appendChild(pilesContainer);

        const dropZone = document.getElementById('discard-pile-dropzone');
        // Ensure event listeners are added only once or cleared if re-rendered
        // (This basic implementation might add listeners multiple times if renderPiles is called often without clearing)
        dropZone.ondragover = (e) => { // Use on-event handlers to avoid duplicates simply
            e.preventDefault();
            dropZone.classList.add('over');
        };
        dropZone.ondragleave = () => {
            dropZone.classList.remove('over');
        };
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('over');
            if (draggedCardIndex !== -1) {
                const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
                const currentPlayer = gameState.players[gameState.currentPlayerIndex]; // Added check
                const isMyTurn = myPlayer && currentPlayer && currentPlayer.playerId === myPlayer.playerId;


                if(isMyTurn && !gameState.isPaused && !gameState.roundOver) {
                    const playedCard = myPlayer.hand[draggedCardIndex];
                    if (isClientMoveValid(playedCard, gameState)) {
                        socket.emit('playCard', { cardIndex: draggedCardIndex });
                    } else {
                        if (draggedCardElement) {
                            triggerInvalidMoveFeedback(draggedCardElement);
                        }
                    }
                }
                 // Reset drag state regardless of validity
                if (draggedCardElement) draggedCardElement.style.opacity = '1';
                draggedCardElement = null;
                draggedCardIndex = -1;
            }
        };
    }

    function renderPlayers(gameState) {
        const leftColumn = document.getElementById('left-column');
        leftColumn.innerHTML = '';
        const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) return;

        const isHost = myPlayer.isHost;

        gameState.players.forEach((player, playerIndex) => {
            const playerArea = document.createElement('div');
            playerArea.className = 'player-area';
            playerArea.dataset.playerId = player.playerId;

            if (player.status === 'Disconnected') {
                playerArea.classList.add('disconnected');
            } else if (player.status === 'Removed') {
                playerArea.classList.add('disconnected', 'removed');
            }

            const currentPlayer = gameState.players[gameState.currentPlayerIndex]; // Added check
            const isCurrentPlayer = currentPlayer && playerIndex === gameState.currentPlayerIndex;
            const isDealerChoosing = player.playerId === gameState.needsDealChoice;
            if ((isCurrentPlayer && player.status === 'Active' && !gameState.isPaused && !gameState.roundOver) || isDealerChoosing) {
                playerArea.classList.add('active-player');
            }

            playerArea.classList.remove('uno-unsafe', 'uno-declared', 'has-uno');
            if (player.unoState === 'unsafe') {
                playerArea.classList.add('uno-unsafe');
            } else if (player.unoState === 'declared' && player.playerId === myPersistentPlayerId) {
                playerArea.classList.add('uno-declared');
            }
            if (player.hand.length === 1 && !gameState.roundOver) {
                playerArea.classList.add('has-uno');
            }

            const playerInfo = document.createElement('div');
            playerInfo.className = 'player-info';

            const nameSpan = document.createElement('span');
            const hostIndicator = player.isHost ? '👑 ' : '';
            nameSpan.innerHTML = `${hostIndicator}${player.name} (${player.hand.length} cards) <span class="player-score">Score: ${player.score}</span>`;
            playerInfo.appendChild(nameSpan);

            if (isHost && player.playerId !== myPersistentPlayerId && player.status === 'Active' && !gameState.roundOver) {
                const afkBtn = document.createElement('button');
                afkBtn.className = 'mark-afk-btn';
                afkBtn.textContent = 'Mark AFK';
                afkBtn.dataset.playerId = player.playerId;
                playerInfo.appendChild(afkBtn);
            }

            playerArea.appendChild(playerInfo);

            const cardContainer = document.createElement('div');
            cardContainer.className = 'card-container';

            if (player.playerId === myPersistentPlayerId) {
                 // Get the hand directly from the current gameState being rendered
                const currentHand = player.hand;

                currentHand.forEach((card, indexInHand) => {
                    // We need the original index if the hand was ever rearranged server-side
                    // But since we send the whole hand on rearrange, `indexInHand` *should* be the correct index relative to the *current* server state.
                    const originalCardIndex = indexInHand; // Assuming simple case for now

                    const cardEl = createCardElement(card, originalCardIndex);

                    const isMyTurn = isCurrentPlayer; // Use already calculated variable
                    if (isMyTurn && !gameState.isPaused && !gameState.roundOver && player.status === 'Active') {
                        cardEl.classList.add('clickable');
                    }

                    cardEl.addEventListener('click', () => {
                        if (isMyTurn && !gameState.isPaused && !gameState.roundOver && player.status === 'Active') {
                            if (isClientMoveValid(card, gameState)) {
                                socket.emit('playCard', { cardIndex: originalCardIndex });
                            } else {
                                triggerInvalidMoveFeedback(cardEl);
                            }
                        }
                    });

                    cardEl.draggable = isMyTurn && !gameState.isPaused && !gameState.roundOver; // Only draggable on my turn
                    cardContainer.appendChild(cardEl);
                });


                 // --- Drag and Drop for Player's Hand ---
                cardContainer.ondragstart = e => { // Use on-event handlers
                    if (!e.target.classList.contains('card') || gameState.isPaused || gameState.roundOver) {
                        e.preventDefault();
                        return;
                    }
                    draggedCardElement = e.target;
                    draggedCardIndex = parseInt(e.target.dataset.cardIndex);
                    // Add dragging class for visual feedback (optional)
                     setTimeout(() => e.target.classList.add('dragging'), 0);
                    // Use dataTransfer for better drag compatibility (optional but good practice)
                    // e.dataTransfer.setData('text/plain', draggedCardIndex);
                    // e.dataTransfer.effectAllowed = 'move';
                };

                cardContainer.ondragend = e => { // Use on-event handlers
                    if (draggedCardElement) {
                        draggedCardElement.classList.remove('dragging');
                        // Update opacity immediately
                        draggedCardElement.style.opacity = '1';

                        // Check if the drop occurred *outside* a valid dropzone (like discard pile)
                        // If dropped outside, or drag cancelled, potentially re-render or just reset state
                         // Re-ordering logic:
                        const myCurrentPlayerState = window.gameState?.players.find(p => p.playerId === myPersistentPlayerId);
                        if (myCurrentPlayerState) {
                             const newElements = [...cardContainer.querySelectorAll('.card')];
                             // Filter out the ghost element if it's still there briefly
                             const validElements = newElements.filter(el => el !== draggedCardElement || !el.classList.contains('dragging'));
                             const newIndices = validElements.map(el => parseInt(el.dataset.cardIndex));

                             // Get the server hand corresponding to the *current* gameState
                             const serverHand = myCurrentPlayerState.hand;

                             // Check if indices are valid and match hand length before reordering
                            if (newIndices.length === serverHand.length && newIndices.every(idx => idx >= 0 && idx < serverHand.length)) {
                                const reorderedHand = newIndices.map(originalIndex => serverHand[originalIndex]).filter(Boolean); // Filter out potential undefineds
                                if (reorderedHand.length === serverHand.length) { // Final check
                                    socket.emit('rearrangeHand', { newHand: reorderedHand });
                                     // Optimistic update (optional)
                                     myPlayer.hand = reorderedHand;
                                     // Re-render just my hand immediately might be smoother
                                     // renderPlayers(window.gameState); // Be careful of infinite loops
                                }
                            } else {
                                console.warn("Index mismatch during drag reorder, not sending update.");
                                // Force re-render from server state if needed
                                // displayGame(window.gameState);
                            }
                        }
                        draggedCardElement = null;
                        draggedCardIndex = -1;
                    }
                };

                cardContainer.ondragover = e => { // Use on-event handlers
                    e.preventDefault();
                    if (!draggedCardElement || gameState.isPaused || gameState.roundOver) return; // Only allow drop if dragging and game active
                    const afterElement = getDragAfterElement(cardContainer, e.clientX);
                    if (afterElement == null) {
                        cardContainer.appendChild(draggedCardElement);
                    } else {
                        cardContainer.insertBefore(draggedCardElement, afterElement);
                    }
                };

            } else { // Other players
                if (gameState.roundOver && player.status === 'Active') {
                    player.hand.forEach((card, cardIndex) => {
                        const cardEl = createCardElement(card, cardIndex);
                        cardContainer.appendChild(cardEl);
                    });
                } else {
                    if (player.hand.length === 1) {
                        const cardEl = document.createElement('div');
                        cardEl.className = 'card uno-warning';
                        const unoSpan = document.createElement('span');
                        unoSpan.textContent = 'UNO';
                        cardEl.appendChild(unoSpan);
                        cardContainer.appendChild(cardEl);
                    } else {
                        for (let j = 0; j < player.hand.length; j++) {
                            const cardEl = document.createElement('div');
                            cardEl.className = 'card card-back';
                            cardContainer.appendChild(cardEl);
                        }
                    }
                }
            }
            playerArea.appendChild(cardContainer);
            leftColumn.appendChild(playerArea);
        });
    }

    function getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            // Find the element immediately to the right of the cursor
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- Make modals draggable for both mouse and touch ---
    makeDraggable(document.getElementById('color-picker-modal'));
    makeDraggable(document.getElementById('drawn-wild-modal'));
    makeDraggable(document.getElementById('pick-until-modal'));
    makeDraggable(document.getElementById('swap-modal'));
    makeDraggable(document.getElementById('deal-choice-modal'));
    makeDraggable(document.getElementById('confirm-end-game-modal'));
    makeDraggable(document.getElementById('end-of-round-div'));
    makeDraggable(document.getElementById('final-score-modal'));
    makeDraggable(document.getElementById('afk-notification-modal'));
    makeDraggable(document.getElementById('discard-pile-modal'));
    makeDraggable(document.getElementById('confirm-afk-modal')); // *** NEW ***

});