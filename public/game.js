window.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://gupte-family-uno-game.onrender.com');

    let myPersistentPlayerId = sessionStorage.getItem('unoPlayerId');
    let isGameOver = false;
    let countdownInterval = null;

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


    // --- EVENT LISTENERS (Receiving messages from server) ---

    socket.on('connect', () => {
        console.log('Socket connected with ID:', socket.id);
        if (myPersistentPlayerId) {
            console.log('Attempting to rejoin with existing ID:', myPersistentPlayerId);
            socket.emit('rejoinGame', myPersistentPlayerId);
        }
    });

    socket.on('joinSuccess', ({ playerId, lobby }) => {
        console.log('Successfully joined/registered with ID:', playerId);
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('unoPlayerId', playerId);

        renderLobby(lobby);
    });

    socket.on('lobbyUpdate', (players) => {
        console.log('Received lobbyUpdate from server.');
        if (isGameOver) return;
        renderLobby(players);
    });

    socket.on('updateGameState', (gameState) => {
        if (gameState.roundOver) {
            displayGame(gameState);
        } else {
            joinScreen.style.display = 'none';
            lobbyScreen.style.display = 'none';
            endOfRoundDiv.style.display = 'none';
            gameBoard.style.display = 'flex';
            displayGame(gameState);
        }
    });

    socket.on('roundOver', ({ winnerName, scores, finalGameState }) => {
        displayGame(finalGameState);

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

        if (myPlayer.isHost) {
            hostRoundEndControls.style.display = 'flex';
            nextRoundOkBtn.style.display = 'none';
            nextRoundBtn.disabled = false;
            nextRoundBtn.textContent = 'Start Next Round';
        } else {
            hostRoundEndControls.style.display = 'none';
            nextRoundOkBtn.style.display = 'block';
        }

        endOfRoundDiv.style.display = 'flex';
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

    socket.on('playerDisconnected', ({ playerName }) => {
        showToast(`${playerName} disconnected. Game paused.`);
    });
    socket.on('playerReconnected', ({ playerName }) => {
        showToast(`${playerName} has reconnected!`);
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
        joinScreen.style.display = 'none';
        lobbyScreen.style.display = 'block';
        gameBoard.style.display = 'none';
        endOfRoundDiv.style.display = 'none';
        finalScoreModal.style.display = 'none';

        playerList.innerHTML = '';
        if (gameLogList) gameLogList.innerHTML = '';
        let amIHost = false;
        players.forEach(player => {
            const playerItem = document.createElement('li');
            let content = player.name;
            if (player.isHost) { content += ' 👑 (Host)'; }
            if (player.playerId === myPersistentPlayerId) {
                content += ' (You)';
                amIHost = player.isHost;
            }
            playerItem.textContent = content;
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
        unoAnnouncementOverlay.classList.add('show');
        setTimeout(() => {
            unoAnnouncementOverlay.classList.remove('show');
        }, 1500);
    }

    function isClientMoveValid(playedCard, gameState) {
        if (!gameState || !gameState.discardPile || gameState.discardPile.length === 0) return false;
        const topCard = gameState.discardPile[0];
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
            cardBack.style.left = `${startRect.left - boardRect.top}px`;
            cardBack.style.transform = 'scale(1.2)';
            gameBoard.appendChild(cardBack);

            setTimeout(() => {
                requestAnimationFrame(() => {
                    const top = `${endRect.top - boardRect.top + 10}px`;
                    const left = `${endRect.left - boardRect.left + (i * 20)}px`;
                    cardBack.style.transform = `scale(${scaleFactor})`;
                    cardBack.style.top = top;
                    cardBack.style.left = left;
                });
            }, i * 100);

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
            if (p.score < lowestScore) {
                lowestScore = p.score;
            }
            footerHtml += `<td><strong>${p.score}</strong></td>`;
        });
        footerHtml += '</tr></tfoot>';

        table.innerHTML = headerHtml + bodyHtml + footerHtml;
        finalScoreTableContainer.innerHTML = '';
        finalScoreTableContainer.appendChild(table);

        const winners = players.filter(p => p.score === lowestScore);
        const winnerNames = winners.map(w => w.name).join(' and ');
        finalWinnerMessage.textContent = `${winnerNames} win(s) the game!`;
    }


    function createCardElement(card, cardIndex) {
        const cardDiv = document.createElement('div');
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
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function elementTouchDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.touches[0].clientX;
            pos2 = pos4 - e.touches[0].clientY;
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            document.ontouchend = null;
            document.ontouchmove = null;
        }

        if (header) {
            header.onmousedown = dragMouseDown;
            header.ontouchstart = touchDown;
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
        if (!myPlayer) return;

        const isMyTurn = myPlayer && gameState.players[gameState.currentPlayerIndex]?.playerId === myPlayer.playerId;
        const gameSuspended = gameState.isSuspended;
        const isHost = myPlayer.isHost;

        endGameBtn.style.display = (isHost && !gameState.roundOver) ? 'block' : 'none';

        if (actionBar) {
            if (gameSuspended && gameState.suspensionInfo) {
                const { disconnectTime } = gameState.suspensionInfo;
                // NEW: Find all disconnected players
                const disconnectedNames = gameState.players
                    .filter(p => !p.isConnected)
                    .map(p => p.name)
                    .join(', ');

                const updateTimer = () => {
                    const elapsed = (Date.now() - disconnectTime) / 1000;
                    const remaining = Math.max(0, Math.floor(60 - elapsed));
                    // NEW: Display all names
                    actionBar.textContent = `Waiting ${remaining}s for ${disconnectedNames} to rejoin...`;
                };
                updateTimer();
                countdownInterval = setInterval(updateTimer, 1000);

            } else if (gameState.roundOver) {
                const host = gameState.players.find(p => p.isHost);
                const hostIsReady = gameState.readyForNextRound.includes(host?.playerId);
                const connectedPlayers = gameState.players.filter(p => p.isConnected);
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
                if (currentPlayer.isConnected) {
                    actionBar.textContent = `Waiting for ${currentPlayer.name} to play...`;
                } else {
                    actionBar.textContent = `Waiting for ${currentPlayer.name} to reconnect...`;
                }
            } else {
                actionBar.textContent = "Game is starting...";
            }
        }

        if (gameState.roundOver && !gameState.readyForNextRound.includes(myPlayer.playerId)) {
            endOfRoundDiv.style.display = 'flex';
        }


        if (unoBtn) {
            if (gameState.activeColor && gameState.activeColor !== 'Black') {
                const colorMap = { "Red": "#ff5555", "Green": "#55aa55", "Blue": "#5555ff", "Yellow": "#ffaa00" };
                unoBtn.style.backgroundColor = colorMap[gameState.activeColor];
            } else {
                unoBtn.style.backgroundColor = '#333';
            }
            if (myPlayer && myPlayer.hand.length === 2 && !gameSuspended && !gameState.roundOver) {
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
                const firstName = currentPlayer.name.split(' ')[0];

                if (isPickUntilActive) {
                    drawCardBtn.textContent = `${firstName} PICKS FOR ${pickUntilInfo.targetColor.toUpperCase()}`;
                } else if (gameState.drawPenalty > 0) {
                    drawCardBtn.textContent = `${firstName} DRAWS ${gameState.drawPenalty}`;
                } else {
                    drawCardBtn.textContent = 'DRAW CARD';
                }

                drawCardBtn.disabled = !isMyTurn || gameSuspended || gameState.roundOver;
            } else {
                 drawCardBtn.textContent = 'DRAW CARD';
                 drawCardBtn.disabled = true;
            }
        }

        colorPickerModal.style.display = (gameState.needsColorChoice === myPersistentPlayerId && !gameSuspended) ? 'flex' : 'none';
        pickUntilModal.style.display = (gameState.needsPickUntilChoice === myPersistentPlayerId && !gameSuspended) ? 'flex' : 'none';
        dealChoiceModal.style.display = (gameState.needsDealChoice === myPersistentPlayerId && !gameSuspended) ? 'flex' : 'none';

        if (gameState.needsSwapChoice === myPersistentPlayerId && !gameSuspended) {
            const swapOptions = document.getElementById('swap-player-options');
            swapOptions.innerHTML = '';
            gameState.players.forEach(player => {
                if (player.playerId !== myPersistentPlayerId && player.isConnected) {
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
        const topCard = gameState.discardPile[0];
        if (topCard) {
            const topCardElement = createCardElement(topCard, -1);
            discardPileDiv.appendChild(topCardElement);
        }
        discardPileWrapper.appendChild(discardPileTitle);
        discardPileWrapper.appendChild(discardCount);
        discardPileWrapper.appendChild(discardPileDiv);
        pilesContainer.appendChild(drawPileWrapper);
        pilesContainer.appendChild(discardPileWrapper);
        pilesArea.appendChild(pilesContainer);

        const dropZone = document.getElementById('discard-pile-dropzone');
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('over');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('over');
            if (draggedCardIndex !== -1) {
                const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
                const isMyTurn = myPlayer && gameState.players[gameState.currentPlayerIndex].playerId === myPlayer.playerId;

                if(isMyTurn && !gameState.isSuspended && !gameState.roundOver) {
                    const playedCard = myPlayer.hand[draggedCardIndex];
                    if (isClientMoveValid(playedCard, gameState)) {
                        socket.emit('playCard', { cardIndex: draggedCardIndex });
                    } else {
                        if (draggedCardElement) {
                            triggerInvalidMoveFeedback(draggedCardElement);
                        }
                    }
                }
            }
        });
    }

    function renderPlayers(gameState) {
        const leftColumn = document.getElementById('left-column');
        leftColumn.innerHTML = '';
        const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) return;

        gameState.players.forEach((player, playerIndex) => {
            const playerArea = document.createElement('div');
            playerArea.className = 'player-area';
            playerArea.dataset.playerId = player.playerId;

            if (!player.isConnected) {
                playerArea.classList.add('disconnected');
            }

            const isCurrentPlayer = playerIndex === gameState.currentPlayerIndex;
            const isDealerChoosing = player.playerId === gameState.needsDealChoice;
            if ((isCurrentPlayer && player.isConnected && !gameState.isSuspended && !gameState.roundOver) || isDealerChoosing) {
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
            const hostIndicator = player.isHost ? '👑 ' : '';
            playerInfo.innerHTML = `${hostIndicator}${player.name} (${player.hand.length} cards) <span class="player-score">Score: ${player.score}</span>`;
            playerArea.appendChild(playerInfo);

            const cardContainer = document.createElement('div');
            cardContainer.className = 'card-container';

            if (player.playerId === myPersistentPlayerId) {
                const serverHand = window.gameState.players.find(p => p.playerId === myPersistentPlayerId).hand;

                player.hand.forEach((card, clientIndex) => {
                    const originalCardIndex = serverHand.findIndex((serverCard, serverIndex) => 
                        serverCard.color === card.color && serverCard.value === card.value && !Array.from(cardContainer.children).some(el => parseInt(el.dataset.cardIndex) === serverIndex)
                    );

                    const cardEl = createCardElement(card, originalCardIndex);

                    const isMyTurn = playerIndex === gameState.currentPlayerIndex;
                    if (isMyTurn && !gameState.isSuspended && !gameState.roundOver && player.isConnected) {
                        cardEl.classList.add('clickable');
                    }

                    cardEl.addEventListener('click', () => {
                        if (isMyTurn && !gameState.isSuspended && !gameState.roundOver && player.isConnected) {
                            if (isClientMoveValid(card, gameState)) {
                                socket.emit('playCard', { cardIndex: originalCardIndex });
                            } else {
                                triggerInvalidMoveFeedback(cardEl);
                            }
                        }
                    });

                    cardEl.draggable = !gameState.isSuspended && !gameState.roundOver;
                    cardContainer.appendChild(cardEl);
                });

                cardContainer.addEventListener('dragstart', e => {
                    if (gameState.isSuspended || gameState.roundOver) {
                        e.preventDefault();
                        return;
                    }
                    if (e.target.classList.contains('card')) {
                       draggedCardElement = e.target;
                       draggedCardIndex = parseInt(e.target.dataset.cardIndex);
                       setTimeout(() => e.target.style.opacity = '0.5', 0);
                    }
                });

                cardContainer.addEventListener('dragend', e => {
                    if (e.target.classList.contains('card')) {
                       setTimeout(() => {
                            e.target.style.opacity = '1';
                            const myCurrentPlayerState = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                            if (myCurrentPlayerState) {
                                const newElements = [...cardContainer.querySelectorAll('.card')];
                                const newIndices = newElements.map(el => parseInt(el.dataset.cardIndex));
                                const serverHand = window.gameState.players.find(p => p.playerId === myPersistentPlayerId).hand;
                                const reorderedHand = newIndices.map(originalIndex => serverHand[originalIndex]).filter(Boolean);

                                if (reorderedHand.length === myPlayer.hand.length) {
                                    socket.emit('rearrangeHand', { newHand: reorderedHand });
                                    myPlayer.hand = reorderedHand;
                                }
                            }
                            draggedCardElement = null;
                            draggedCardIndex = -1;
                       }, 0);
                    }
                });

                cardContainer.addEventListener('dragover', e => {
                    e.preventDefault();
                    if (gameState.isSuspended || gameState.roundOver) return;
                    const afterElement = getDragAfterElement(cardContainer, e.clientX);
                    if (draggedCardElement) {
                        if (afterElement == null) {
                            cardContainer.appendChild(draggedCardElement);
                        } else {
                            cardContainer.insertBefore(draggedCardElement, afterElement);
                        }
                    }
                });

            } else { 
                if (gameState.roundOver && player.isConnected) {
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

});