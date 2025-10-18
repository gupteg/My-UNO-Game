window.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Assuming server is on the same origin
    // const socket = io('https://gupte-family-uno-game.onrender.com'); // Use this for production

    let myPersistentPlayerId = sessionStorage.getItem('unoPlayerId');
    let isGameOver = false;
    let countdownInterval = null;
    let playerIdToMarkAFK = null;

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
    const afkNotificationModal = document.getElementById('afk-notification-modal');
    const imBackBtn = document.getElementById('im-back-btn');
    const showDiscardPileBtn = document.getElementById('showDiscardPileBtn');
    const discardPileModal = document.getElementById('discard-pile-modal');
    const discardPileList = document.getElementById('discard-pile-list');
    const discardPileOkBtn = document.getElementById('discard-pile-ok-btn');
    const confirmAfkModal = document.getElementById('confirm-afk-modal');
    const confirmAfkPlayerName = document.getElementById('confirm-afk-player-name');
    const confirmAfkYesBtn = document.getElementById('confirm-afk-yes-btn');
    const confirmAfkNoBtn = document.getElementById('confirm-afk-no-btn');
    const discardedWildsModal = document.getElementById('discarded-wilds-modal');
    const discardedWildsList = document.getElementById('discarded-wilds-list');
    const discardedWildsOkBtn = document.getElementById('discarded-wilds-ok-btn');


    joinScreen.style.display = 'block';
    lobbyScreen.style.display = 'none';
    gameBoard.style.display = 'none';

    // --- DRAG AND DROP GLOBALS ---
    let draggedCardElement = null;
    let draggedCardIndex = -1;

    // --- EVENT LISTENERS (Sending messages to server) ---
    // ... (All button/modal listeners remain unchanged) ...
     joinGameBtn.addEventListener('click', () => { const playerName = playerNameInput.value.trim(); if (playerName) { socket.emit('joinGame', { playerName, playerId: myPersistentPlayerId }); } else { alert('Please enter name.'); } });
     playerList.addEventListener('click', (event) => { if (event.target.classList.contains('kick-btn')) { const playerIdToKick = event.target.dataset.playerId; socket.emit('kickPlayer', { playerIdToKick }); } });
     document.getElementById('left-column').addEventListener('click', (event) => { if (event.target.classList.contains('mark-afk-btn')) { playerIdToMarkAFK = event.target.dataset.playerId; const player = window.gameState?.players.find(p => p.playerId === playerIdToMarkAFK); if (player) { confirmAfkPlayerName.textContent = player.name; confirmAfkModal.style.display = 'flex'; } } });
     confirmAfkYesBtn.addEventListener('click', () => { if (playerIdToMarkAFK) { socket.emit('markPlayerAFK', { playerIdToMark: playerIdToMarkAFK }); } confirmAfkModal.style.display = 'none'; playerIdToMarkAFK = null; });
     confirmAfkNoBtn.addEventListener('click', () => { confirmAfkModal.style.display = 'none'; playerIdToMarkAFK = null; });
     imBackBtn.addEventListener('click', () => { socket.emit('playerIsBack'); afkNotificationModal.style.display = 'none'; });
     startGameBtn.addEventListener('click', () => { socket.emit('startGame'); });
     drawCardBtn.addEventListener('click', () => { socket.emit('drawCard'); });
     endGameBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'flex'; });
     endGameRoundBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'flex'; });
     confirmEndNoBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'none'; });
     confirmEndYesBtn.addEventListener('click', () => { confirmEndGameModal.style.display = 'none'; socket.emit('endGame'); });
     finalScoreOkBtn.addEventListener('click', () => { isGameOver = false; finalScoreModal.style.display = 'none'; gameBoard.style.display = 'none'; lobbyScreen.style.display = 'none'; joinScreen.style.display = 'block'; sessionStorage.clear(); myPersistentPlayerId = null; });
     unoBtn.addEventListener('click', () => { socket.emit('callUno'); unoBtn.classList.add('pressed'); setTimeout(() => unoBtn.classList.remove('pressed'), 300); });
     nextRoundBtn.addEventListener('click', () => { socket.emit('playerReadyForNextRound'); nextRoundBtn.disabled = true; nextRoundBtn.textContent = 'Waiting...'; });
     nextRoundOkBtn.addEventListener('click', () => { socket.emit('playerReadyForNextRound'); endOfRoundDiv.style.display = 'none'; });
     dealCardsBtn.addEventListener('click', () => { const numCards = dealCardsInput.value; socket.emit('dealChoice', { numCards }); });
     colorPickerModal.addEventListener('click', (event) => { if (event.target.matches('.color-btn')) { const color = event.target.dataset.color; socket.emit('colorChosen', { color }); } });
     drawnWildModal.addEventListener('click', (event) => { const cardIndex = parseInt(drawnWildModal.dataset.cardIndex); if (event.target.id === 'option-play-wild') { socket.emit('choosePlayDrawnWild', { play: true, cardIndex }); } else if (event.target.id === 'option-keep-wild') { socket.emit('choosePlayDrawnWild', { play: false, cardIndex }); } drawnWildModal.style.display = 'none'; });
     pickUntilModal.addEventListener('click', (event) => { let choice = null; if (event.target.id === 'option-pick-color') { choice = 'pick-color'; } else if (event.target.id === 'option-discard-wilds') { choice = 'discard-wilds'; } if (choice) { socket.emit('pickUntilChoice', { choice }); } pickUntilModal.style.display = 'none'; });
     swapModal.addEventListener('click', (event) => { if (event.target.matches('.player-swap-btn')) { const targetPlayerId = event.target.dataset.playerId; socket.emit('swapHandsChoice', { targetPlayerId }); swapModal.style.display = 'none'; } });
     arrangeHandBtn.addEventListener('click', () => { const myPlayer = window.gameState?.players.find(p => p.playerId === myPersistentPlayerId); if (!myPlayer) return; const colorOrder = { 'Black': 0, 'Blue': 1, 'Green': 2, 'Red': 3, 'Yellow': 4 }; const valueOrder = { 'Draw Two': 12, 'Skip': 11, 'Reverse': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2, '1': 1, '0': 0, 'Wild': -1, 'Wild Draw Four': -1, 'Wild Pick Until': -1, 'Wild Swap': -1 }; const sortedHand = [...myPlayer.hand].sort((a, b) => { const colorComparison = colorOrder[a.color] - colorOrder[b.color]; if (colorComparison !== 0) return colorComparison; return valueOrder[b.value] - valueOrder[a.value]; }); myPlayer.hand = sortedHand; socket.emit('rearrangeHand', { newHand: sortedHand }); displayGame(window.gameState); });
     showDiscardPileBtn.addEventListener('click', () => { if (!window.gameState) return; const lastTenDiscards = window.gameState.discardPile.slice(0, 10); discardPileList.innerHTML = ''; if (lastTenDiscards.length === 0) { discardPileList.innerHTML = '<p>Empty.</p>'; } else { lastTenDiscards.forEach(item => { const discardItemDiv = document.createElement('div'); discardItemDiv.className = 'discard-item'; const playerP = document.createElement('p'); playerP.className = 'discard-item-player'; playerP.textContent = `By: ${item.playerName || '?'}`; if (item.card) { const cardEl = createCardElement(item.card, -1); discardItemDiv.appendChild(cardEl); discardItemDiv.appendChild(playerP); discardPileList.appendChild(discardItemDiv); } else { console.warn("Missing card data:", item); } }); } discardPileModal.style.display = 'flex'; });
     discardPileOkBtn.addEventListener('click', () => { discardPileModal.style.display = 'none'; });
     discardedWildsOkBtn.addEventListener('click', () => { discardedWildsModal.style.display = 'none'; });

    // --- EVENT LISTENERS (Receiving messages from server) ---
    // ... (Most listeners remain unchanged) ...
    socket.on('connect', () => { console.log('Socket connected:', socket.id); if (myPersistentPlayerId) { const playerName = playerNameInput.value.trim() || "Player"; socket.emit('joinGame', { playerName, playerId: myPersistentPlayerId }); } });
    socket.on('joinSuccess', ({ playerId, lobby }) => { myPersistentPlayerId = playerId; sessionStorage.setItem('unoPlayerId', playerId); renderLobby(lobby); });
    socket.on('lobbyUpdate', (players) => { if (!isGameOver) renderLobby(players); });
    socket.on('updateGameState', (gameState) => { if (gameState.roundOver) { displayGame(gameState); } else { joinScreen.style.display = 'none'; lobbyScreen.style.display = 'none'; endOfRoundDiv.style.display = 'none'; gameBoard.style.display = 'flex'; displayGame(gameState); } });
    socket.on('announceRoundWinner', ({ winnerNames }) => { let message = `${winnerNames} wins!`; if (winnerNames.includes(' and ')) { message = `${winnerNames} win!`; } showUnoAnnouncement(message); });
    socket.on('roundOver', ({ winnerName, scores, finalGameState }) => { setTimeout(() => { displayGame(finalGameState); document.getElementById('winner-message').textContent = `${winnerName} win(s)!`; const scoresDisplay = document.getElementById('scores-display'); scoresDisplay.innerHTML = '<h3>Scores</h3>'; const scoreTable = document.createElement('table'); scoreTable.className = 'score-table'; let tableHTML = '<thead><tr><th>Player</th><th>Hand</th><th>Total</th></tr></thead><tbody>'; const sortedPlayers = [...finalGameState.players].sort((a,b) => a.score - b.score); sortedPlayers.forEach(p => { const roundScore = p.scoresByRound[p.scoresByRound.length - 1]; const displayScore = roundScore !== undefined ? roundScore : '-'; const isWinner = winnerName.includes(p.name); tableHTML += `<tr class="${isWinner ? 'winner-row' : ''}"><td>${p.name} ${p.status === 'Removed' ? '(Rem)' : ''}</td><td>${displayScore}</td><td>${p.score}</td></tr>`; }); tableHTML += '</tbody>'; scoreTable.innerHTML = tableHTML; scoresDisplay.appendChild(scoreTable); const myPlayer = finalGameState.players.find(p => p.playerId === myPersistentPlayerId); if (myPlayer && myPlayer.isHost && myPlayer.status !== 'Removed') { hostRoundEndControls.style.display = 'flex'; nextRoundOkBtn.style.display = 'none'; nextRoundBtn.disabled = false; nextRoundBtn.textContent = 'Next Round'; } else if (myPlayer && myPlayer.status !== 'Removed') { hostRoundEndControls.style.display = 'none'; nextRoundOkBtn.style.display = 'block'; } else { hostRoundEndControls.style.display = 'none'; nextRoundOkBtn.style.display = 'none'; } endOfRoundDiv.style.display = 'flex'; }, 2000); });
    socket.on('finalGameOver', (finalGameState) => { isGameOver = true; gameBoard.style.display = 'none'; endOfRoundDiv.style.display = 'none'; renderFinalScores(finalGameState); finalScoreModal.style.display = 'flex'; });
    socket.on('drawnWildCard', ({ cardIndex, drawnCard }) => { if (window.gameState) { const myPlayer = window.gameState.players.find(p => p.playerId === myPersistentPlayerId); if (myPlayer && !myPlayer.hand.some((c, idx) => idx === cardIndex)) { if(drawnCard && drawnCard.color && drawnCard.value) { myPlayer.hand.splice(cardIndex, 0, drawnCard); displayGame(window.gameState); } else { console.error("Invalid drawnWild data:", drawnCard); } } } drawnWildModal.dataset.cardIndex = cardIndex; drawnWildModal.style.display = 'flex'; });
    socket.on('announce', (message) => { showToast(message); });
    socket.on('youWereMarkedAFK', () => { afkNotificationModal.style.display = 'flex'; });
    socket.on('unoCalled', ({ playerName }) => { showUnoAnnouncement(`${playerName} UNO!`); });
    socket.on('gameLog', (message) => { addMessageToGameLog(message); });
    socket.on('animateDraw', ({ playerId, count }) => { animateCardDraw(playerId, count); });
    socket.on('animateSwap', ({ p1_id, p2_id }) => { animateHandSwap(p1_id, p2_id); });
    socket.on('animatePlay', ({ playerId, card, cardIndex }) => { animateCardPlay(playerId, card, cardIndex); });
    socket.on('showDiscardedWildsModal', (discardedInfo) => { if (!discardedInfo || discardedInfo.length === 0) return; discardedWildsList.innerHTML = ''; discardedInfo.forEach(playerInfo => { const sectionDiv = document.createElement('div'); sectionDiv.className = 'discarded-wilds-player-section'; const nameHeader = document.createElement('h4'); nameHeader.textContent = `${playerInfo.playerName}:`; sectionDiv.appendChild(nameHeader); const cardsContainer = document.createElement('div'); cardsContainer.className = 'card-container'; if (playerInfo.cards && playerInfo.cards.length > 0) { playerInfo.cards.forEach(card => { const cardEl = createCardElement(card, -1); cardsContainer.appendChild(cardEl); }); } else { cardsContainer.textContent = 'None.'; } sectionDiv.appendChild(cardsContainer); discardedWildsList.appendChild(sectionDiv); }); discardedWildsModal.style.display = 'flex'; });

    // --- ALL DISPLAY AND HELPER FUNCTIONS ---
    // ... (renderLobby, showToast, showUnoAnnouncement, isClientMoveValid, triggerInvalidMoveFeedback, animations, addMessageToGameLog, renderFinalScores, createCardElement, makeDraggable - all remain unchanged) ...
    function renderLobby(players) { const me = players.find(p => p.playerId === myPersistentPlayerId); if (!me) { showToast("Kicked."); sessionStorage.clear(); myPersistentPlayerId = null; setTimeout(() => { location.reload(); }, 1500); return; } joinScreen.style.display = 'none'; lobbyScreen.style.display = 'block'; gameBoard.style.display = 'none'; endOfRoundDiv.style.display = 'none'; finalScoreModal.style.display = 'none'; playerList.innerHTML = ''; if (gameLogList) gameLogList.innerHTML = ''; let amIHost = me.isHost; players.forEach(player => { const li = document.createElement('li'); const span = document.createElement('span'); let txt = player.name; if (player.isHost) txt += ' 👑 (Host)'; if (player.playerId === myPersistentPlayerId) txt += ' (You)'; span.textContent = txt; li.appendChild(span); if (amIHost && player.playerId !== myPersistentPlayerId) { const btn = document.createElement('button'); btn.className = 'kick-btn'; btn.textContent = 'Kick'; btn.dataset.playerId = player.playerId; li.appendChild(btn); } playerList.appendChild(li); }); startGameBtn.style.display = (amIHost && players.length >= 2) ? 'block' : 'none'; hostMessage.style.display = amIHost ? 'none' : 'block'; }
    function showToast(message) { if (!toastNotification) return; toastNotification.textContent = message; toastNotification.classList.add('show'); setTimeout(() => { toastNotification.classList.remove('show'); }, 3000); }
    function showUnoAnnouncement(message) { unoAnnouncementText.textContent = message; if (message.length > 15) { unoAnnouncementText.style.fontSize = '8vw'; } else if (message.length > 10) { unoAnnouncementText.style.fontSize = '10vw'; } else { unoAnnouncementText.style.fontSize = '15vw'; } unoAnnouncementOverlay.classList.add('show'); setTimeout(() => { unoAnnouncementOverlay.classList.remove('show'); }, 1900); }
    function isClientMoveValid(playedCard, gameState) { if (!gameState || !gameState.discardPile || gameState.discardPile.length === 0) return false; const topD = gameState.discardPile[0]; if (!topD || !topD.card) return false; const topC = topD.card; const activeC = gameState.activeColor; const drawP = gameState.drawPenalty; if (drawP > 0) return playedCard.value === topC.value; if (playedCard.color === 'Black') return true; if (playedCard.color === activeC || playedCard.value === topC.value) return true; return false; }
    function triggerInvalidMoveFeedback(el) { el.classList.add('invalid-shake'); const rect = el.getBoundingClientRect(); const boardRect = gameBoard.getBoundingClientRect(); invalidMoveCallout.style.top = `${rect.top - boardRect.top - 40}px`; invalidMoveCallout.style.left = `${rect.left - boardRect.left + (rect.width / 2) - (invalidMoveCallout.offsetWidth / 2)}px`; invalidMoveCallout.classList.add('show'); setTimeout(() => { el.classList.remove('invalid-shake'); }, 500); setTimeout(() => { invalidMoveCallout.classList.remove('show'); }, 1500); }
    function animateCardPlay(pId, card, cIdx) { const discardEl = document.querySelector('#discard-pile-dropzone .card'); const playerEl = document.querySelector(`[data-player-id="${pId}"]`); if (!discardEl || !playerEl) return; const startR = playerEl.getBoundingClientRect(); const endR = discardEl.getBoundingClientRect(); const boardR = gameBoard.getBoundingClientRect(); const clone = createCardElement(card, -1); clone.classList.add('flying-card'); clone.style.top = `${startR.top - boardR.top + (startR.height / 2) - 60}px`; clone.style.left = `${startR.left - boardR.left + (startR.width / 2) - 40}px`; clone.style.width = '80px'; clone.style.height = '120px'; if (pId === myPersistentPlayerId && window.gameState) { const myP = window.gameState.players.find(p => p.playerId === myPersistentPlayerId); if (myP) { const hideEl = playerEl.querySelector(`.card[data-card-index="${cIdx}"]`); if(hideEl) hideEl.style.visibility = 'hidden'; else console.warn(`No card el ${cIdx}`); } } gameBoard.appendChild(clone); requestAnimationFrame(() => { clone.style.top = `${endR.top - boardR.top}px`; clone.style.left = `${endR.left - boardR.left}px`; clone.style.transform = `rotate(360deg)`; clone.style.width = `${endR.width}px`; clone.style.height = `${endR.height}px`; }); setTimeout(() => { clone.remove(); }, 800); }
    function animateCardDraw(pId, count) { const drawEl = document.querySelector('.piles-container .card-back'); const playerEl = document.querySelector(`[data-player-id="${pId}"] .card-container`); if (!drawEl || !playerEl) return; const startR = drawEl.getBoundingClientRect(); const endR = playerEl.getBoundingClientRect(); const boardR = gameBoard.getBoundingClientRect(); const smallW = 80; const scaleF = smallW / startR.width; for (let i = 0; i < count; i++) { const cb = document.createElement('div'); cb.className = 'card card-back flying-card'; cb.style.top = `${startR.top - boardR.top}px`; cb.style.left = `${startR.left - boardR.top}px`; cb.style.width = `${startR.width}px`; cb.style.height = `${startR.height}px`; cb.style.transform = 'scale(1.2)'; gameBoard.appendChild(cb); setTimeout(() => { requestAnimationFrame(() => { const top = `${endR.top - boardR.top + 10}px`; const left = `${endR.left - boardR.left + (i * (smallW / 4))}px`; cb.style.transform = `scale(${scaleF})`; cb.style.top = top; cb.style.left = left; cb.style.width = `${smallW}px`; cb.style.height = `${smallW * 1.5}px`; }); }, i * 100 + 50); setTimeout(() => { cb.remove(); }, 800 + (i * 100)); } }
    function animateHandSwap(p1, p2) { const p1area = document.querySelector(`[data-player-id="${p1}"]`); const p2area = document.querySelector(`[data-player-id="${p2}"]`); if (!p1area || !p2area) return; const p1cards = p1area.querySelectorAll('.card-container .card'); const p2cards = p2area.querySelectorAll('.card-container .card'); const boardR = gameBoard.getBoundingClientRect(); const anim = (cards, toArea) => { const endR = toArea.querySelector('.card-container').getBoundingClientRect(); const clones = []; cards.forEach(c => { const startR = c.getBoundingClientRect(); const cl = c.cloneNode(true); cl.classList.add('flying-card'); cl.style.top = `${startR.top - boardR.top}px`; cl.style.left = `${startR.left - boardR.left}px`; gameBoard.appendChild(cl); clones.push(cl); c.style.visibility = 'hidden'; }); clones.forEach((cl, i) => { setTimeout(() => { requestAnimationFrame(() => { const t = `${endR.top - boardR.top + 10}px`; const l = `${endR.left - boardR.left + (i * 20)}px`; cl.style.top = t; cl.style.left = l; }); }, i * 50); setTimeout(() => cl.remove(), 800 + (i*50)); }); }; anim(p1cards, p2area); anim(p2cards, p1area); }
    function addMessageToGameLog(msg) { if (!gameLogList) return; const li = document.createElement('li'); li.textContent = msg; gameLogList.prepend(li); while (gameLogList.children.length > 8) { gameLogList.lastChild.remove(); } }
    function renderFinalScores(gs) { const players = gs.players; const numR = gs.roundNumber; const tbl = document.createElement('table'); tbl.className = 'score-table final-table'; let h = '<thead><tr><th>Rnd</th>'; players.forEach(p => { h += `<th>${p.name}</th>`; }); h += '</tr></thead>'; let b = '<tbody>'; for (let i = 0; i < numR; i++) { b += `<tr><td>${i + 1}</td>`; players.forEach(p => { const s = p.scoresByRound[i] !== undefined ? p.scoresByRound[i] : '-'; b += `<td>${s}</td>`; }); b += '</tr>'; } b += '</tbody>'; let f = '<tfoot><tr><td><strong>Total</strong></td>'; let lowS = Infinity; players.forEach(p => { if (p.status === 'Active' || p.status === 'Disconnected') { if (p.score < lowS) lowS = p.score; } f += `<td><strong>${p.score}</strong></td>`; }); f += '</tr></tfoot>'; tbl.innerHTML = h + b + f; finalScoreTableContainer.innerHTML = ''; finalScoreTableContainer.appendChild(tbl); const winners = players.filter(p => (p.status === 'Active' || p.status === 'Disconnected') && p.score === lowS); const names = winners.map(w => w.name).join(' & '); finalWinnerMessage.textContent = `${names} win(s)!`; }
    function createCardElement(card, cIdx) { const div = document.createElement('div'); if (!card || !card.color || !card.value) { console.error("Bad card data:", card); div.className = 'card Black'; div.textContent = '?'; return div; } div.className = `card ${card.color}`; div.dataset.cardIndex = cIdx; if (!isNaN(card.value)) { const span = document.createElement('span'); span.className = 'number-circle'; span.textContent = card.value; div.appendChild(span); } else { const span = document.createElement('span'); span.className = 'action-text'; span.innerHTML = card.value.replace(/\s/g, '<br>'); div.appendChild(span); } return div; }
    function makeDraggable(el) { let p1=0, p2=0, p3=0, p4=0; const hdr = el.querySelector('.modal-content h3, .modal-content h2, .modal-content p'); function down(e) { e.preventDefault(); p3=e.clientX; p4=e.clientY; document.onmouseup=up; document.onmousemove=move; } function tDown(e) { p3=e.touches[0].clientX; p4=e.touches[0].clientY; document.ontouchend=up; document.ontouchmove=tMove; } function move(e) { e.preventDefault(); p1=p3-e.clientX; p2=p4-e.clientY; p3=e.clientX; p4=e.clientY; el.style.top=(el.offsetTop-p2)+"px"; el.style.left=(el.offsetLeft-p1)+"px"; } function tMove(e) { e.preventDefault(); p1=p3-e.touches[0].clientX; p2=p4-e.touches[0].clientY; p3=e.touches[0].clientX; p4=e.touches[0].clientY; el.style.top=(el.offsetTop-p2)+"px"; el.style.left=(el.offsetLeft-p1)+"px"; } function up() { document.onmouseup=null; document.onmousemove=null; document.ontouchend=null; document.ontouchmove=null; } if(hdr){ hdr.style.cursor='move'; hdr.onmousedown=down; hdr.ontouchstart=tDown; } else { const cont = el.querySelector('.modal-content'); if(cont){ cont.style.cursor='move'; cont.onmousedown=down; cont.ontouchstart=tDown; } } }

    // *** MODIFIED: displayGame with safety checks ***
    function displayGame(gameState) {
        console.log("Updating display with gameState:", gameState); // DEBUG: Check received state
        window.gameState = gameState;
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

        renderPlayers(gameState); // Render players+arrows first
        renderPiles(gameState);

        const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) { showToast("Removed."); sessionStorage.clear(); setTimeout(() => location.reload(), 1500); return; }

        // *** Safety check for currentPlayerIndex ***
        const currentPlayerIndexIsValid = gameState.currentPlayerIndex >= 0 && gameState.currentPlayerIndex < gameState.players.length;
        const currentPlayer = currentPlayerIndexIsValid ? gameState.players[gameState.currentPlayerIndex] : null;

        const isMyTurn = myPlayer && currentPlayer && currentPlayer.playerId === myPlayer.playerId;
        const isPaused = gameState.isPaused;
        const isHost = myPlayer.isHost;

        endGameBtn.style.display = (isHost && !gameState.roundOver && !isPaused) ? 'block' : 'none'; // Also hide if paused

        // --- Action Bar Update ---
        if (actionBar) {
            try { // Add try-catch for safety during debugging
                if (isPaused && gameState.pauseInfo && gameState.pauseInfo.pauseEndTime) {
                    const { pauseEndTime, pausedForPlayerNames } = gameState.pauseInfo;
                    const names = pausedForPlayerNames.join(', ');
                    const updateTimer = () => { const remaining = Math.max(0, Math.floor((pauseEndTime - Date.now()) / 1000)); actionBar.textContent = `Waiting ${remaining}s for ${names}...`; };
                    updateTimer();
                    countdownInterval = setInterval(updateTimer, 1000);
                } else if (gameState.roundOver) {
                    const host = gameState.players.find(p => p.isHost && p.status !== 'Removed');
                    const hostIsReady = gameState.readyForNextRound.includes(host?.playerId);
                    const activePlayers = gameState.players.filter(p => p.status === 'Active');
                    const allReady = activePlayers.every(p => gameState.readyForNextRound.includes(p.playerId));
                    if (hostIsReady && !allReady) { const waitingOn = activePlayers.filter(p => !gameState.readyForNextRound.includes(p.playerId)).map(p => p.name).join(', '); actionBar.textContent = `Waiting for ${waitingOn}...`; }
                    else { actionBar.textContent = `Round Over! Waiting...`; }
                } else if (gameState.needsDealChoice) {
                    const dealer = gameState.players.find(p => p.playerId === gameState.needsDealChoice);
                    actionBar.textContent = dealer ? `Waiting for ${dealer.name} to deal...` : 'Waiting for dealer...';
                } else if (gameState.needsColorChoice) {
                    const chooser = gameState.players.find(p => p.playerId === gameState.needsColorChoice);
                    actionBar.textContent = chooser ? `${chooser.name} choosing color...` : 'Choosing color...';
                } else if (currentPlayer) { // *** Use safety-checked currentPlayer ***
                    if (currentPlayer.status === 'Active') { actionBar.textContent = `Waiting for ${currentPlayer.name}...`; }
                    else { actionBar.textContent = `Waiting for ${currentPlayer.name} (Disconnected)...`; }
                } else {
                    actionBar.textContent = "Loading..."; // Fallback if currentPlayer is somehow null
                }
            } catch (error) {
                console.error("Error updating action bar:", error, gameState);
                actionBar.textContent = "Error updating status."; // Show error in bar
            }
        }

        if (!gameState.roundOver) { endOfRoundDiv.style.display = 'none'; }

        // --- UNO Button Update ---
        if (unoBtn) {
             try { // Add try-catch
                if (gameState.activeColor && gameState.activeColor !== 'Black') {
                    const colorMap = { "Red": "#ff5555", "Green": "#55aa55", "Blue": "#5555ff", "Yellow": "#ffaa00" };
                    unoBtn.style.backgroundColor = colorMap[gameState.activeColor] || '#333'; // Add fallback
                } else {
                    unoBtn.style.backgroundColor = '#333';
                }
                // Enable only if player has 2 cards AND it's their turn (or about to be after drawing?) - Let's stick to only on their turn for simplicity.
                unoBtn.disabled = !(myPlayer && myPlayer.hand.length === 2 && isMyTurn && !isPaused && !gameState.roundOver);
                unoBtn.classList.toggle('uno-ready', !unoBtn.disabled);
             } catch (error) {
                  console.error("Error updating UNO button:", error, gameState);
             }
        }

        // --- Draw Button Update ---
        if (drawCardBtn) {
             try { // Add try-catch
                if (currentPlayer) { // *** Use safety-checked currentPlayer ***
                    const pickUntilInfo = gameState.pickUntilState;
                    const isPickUntilActive = pickUntilInfo?.active && pickUntilInfo.targetPlayerIndex === gameState.currentPlayerIndex;
                    if (isPickUntilActive) { drawCardBtn.textContent = `${currentPlayer.name} PICKS FOR ${pickUntilInfo.targetColor.toUpperCase()}`; }
                    else if (gameState.drawPenalty > 0) { drawCardBtn.textContent = `${currentPlayer.name} DRAWS ${gameState.drawPenalty}`; }
                    else { drawCardBtn.textContent = 'DRAW CARD'; }
                    drawCardBtn.disabled = !isMyTurn || isPaused || gameState.roundOver;
                } else { // Handle case where currentPlayer is null
                    drawCardBtn.textContent = 'DRAW CARD';
                    drawCardBtn.disabled = true;
                }
             } catch (error) {
                 console.error("Error updating Draw button:", error, gameState);
                 drawCardBtn.textContent = 'DRAW CARD'; // Reset on error
                 drawCardBtn.disabled = true;
             }
        }

        // --- Modals ---
        colorPickerModal.style.display = (gameState.needsColorChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';
        pickUntilModal.style.display = (gameState.needsPickUntilChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';
        dealChoiceModal.style.display = (gameState.needsDealChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';
        swapModal.style.display = (gameState.needsSwapChoice === myPersistentPlayerId && !isPaused) ? 'flex' : 'none';

        if (gameState.needsSwapChoice === myPersistentPlayerId && !isPaused) { /* ... (swap modal population) ... */ }
    }

    // *** MODIFIED: renderPlayers includes arrow logic ***
    function renderPlayers(gameState) {
        const leftColumn = document.getElementById('left-column');
        leftColumn.innerHTML = '';
        const myPlayer = gameState.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) return;
        const isHost = myPlayer.isHost;

        gameState.players.forEach((player, playerIndex) => {
            const playerArea = document.createElement('div'); /* ... set classes ... */
            playerArea.className = 'player-area'; playerArea.dataset.playerId = player.playerId; if (player.status === 'Disconnected') playerArea.classList.add('disconnected'); else if (player.status === 'Removed') playerArea.classList.add('disconnected', 'removed'); const currentPlayer = gameState.players[gameState.currentPlayerIndex]; const isCurrentPlayer = currentPlayer && playerIndex === gameState.currentPlayerIndex; const isDealerChoosing = player.playerId === gameState.needsDealChoice; if ((isCurrentPlayer && player.status === 'Active' && !gameState.isPaused && !gameState.roundOver) || isDealerChoosing) playerArea.classList.add('active-player'); playerArea.classList.remove('uno-unsafe', 'uno-declared', 'has-uno'); if (player.unoState === 'unsafe') playerArea.classList.add('uno-unsafe'); else if (player.unoState === 'declared' && player.playerId === myPersistentPlayerId) playerArea.classList.add('uno-declared'); if (player.hand.length === 1 && !gameState.roundOver) playerArea.classList.add('has-uno');

            const playerInfo = document.createElement('div'); playerInfo.className = 'player-info';
            const nameSpan = document.createElement('span'); nameSpan.className = 'player-name-info'; const hostInd = player.isHost ? '👑 ' : ''; nameSpan.innerHTML = `${hostInd}${player.name} (${player.hand.length}) <span class="player-score">S:${player.score}</span>`; playerInfo.appendChild(nameSpan);

            // *** Add Direction Arrow ***
            const arrowSpan = document.createElement('span'); arrowSpan.className = 'direction-arrow'; arrowSpan.textContent = gameState.playDirection === 1 ? '→' : '←'; playerInfo.appendChild(arrowSpan);

            if (isHost && player.playerId !== myPersistentPlayerId && player.status === 'Active' && !gameState.roundOver) { const afkBtn = document.createElement('button'); afkBtn.className = 'mark-afk-btn'; afkBtn.textContent = 'AFK'; afkBtn.dataset.playerId = player.playerId; playerInfo.appendChild(afkBtn); }
            playerArea.appendChild(playerInfo);

            const cardContainer = document.createElement('div'); cardContainer.className = 'card-container';
            // --- Hand Rendering (unchanged) ---
            if (player.playerId === myPersistentPlayerId) { const currentHand = player.hand; currentHand.forEach((card, indexInHand) => { const originalCardIndex = indexInHand; const cardEl = createCardElement(card, originalCardIndex); const isMyTurn = isCurrentPlayer; if (isMyTurn && !gameState.isPaused && !gameState.roundOver && player.status === 'Active') cardEl.classList.add('clickable'); cardEl.addEventListener('click', () => { if (isMyTurn && !gameState.isPaused && !gameState.roundOver && player.status === 'Active') { if (isClientMoveValid(card, gameState)) socket.emit('playCard', { cardIndex: originalCardIndex }); else triggerInvalidMoveFeedback(cardEl); } }); cardEl.draggable = isMyTurn && !gameState.isPaused && !gameState.roundOver; cardContainer.appendChild(cardEl); }); cardContainer.ondragstart = e => { if (!e.target.classList.contains('card') || gameState.isPaused || gameState.roundOver) { e.preventDefault(); return; } draggedCardElement = e.target; draggedCardIndex = parseInt(e.target.dataset.cardIndex); setTimeout(() => e.target.classList.add('dragging'), 0); }; cardContainer.ondragend = e => { if (draggedCardElement) { draggedCardElement.classList.remove('dragging'); draggedCardElement.style.opacity = '1'; const myCurrentPlayerState = window.gameState?.players.find(p => p.playerId === myPersistentPlayerId); if (myCurrentPlayerState) { const validElements = [...cardContainer.querySelectorAll('.card:not(.dragging)')]; const newIndices = validElements.map(el => parseInt(el.dataset.cardIndex)); const serverHand = myCurrentPlayerState.hand; if (newIndices.length === serverHand.length && newIndices.every(idx => idx >= 0 && idx < serverHand.length)) { const reorderedHand = newIndices.map(originalIndex => serverHand[originalIndex]).filter(Boolean); if (reorderedHand.length === serverHand.length) { socket.emit('rearrangeHand', { newHand: reorderedHand }); myPlayer.hand = reorderedHand; } } else { console.warn("Index mismatch."); } } draggedCardElement = null; draggedCardIndex = -1; } }; cardContainer.ondragover = e => { e.preventDefault(); if (!draggedCardElement || gameState.isPaused || gameState.roundOver) return; const afterElement = getDragAfterElement(cardContainer, e.clientX); if (afterElement == null) cardContainer.appendChild(draggedCardElement); else cardContainer.insertBefore(draggedCardElement, afterElement); }; }
            else { if (gameState.roundOver && player.status !== 'Removed') { player.hand.forEach((card, cardIndex) => { const cardEl = createCardElement(card, cardIndex); cardContainer.appendChild(cardEl); }); } else { if (player.hand.length === 1) { const cardEl = document.createElement('div'); cardEl.className = 'card uno-warning'; const unoSpan = document.createElement('span'); unoSpan.textContent = 'UNO'; cardEl.appendChild(unoSpan); cardContainer.appendChild(cardEl); } else { for (let j = 0; j < player.hand.length; j++) { const cardEl = document.createElement('div'); cardEl.className = 'card card-back'; cardContainer.appendChild(cardEl); } } } }
            // --- End Hand Rendering ---
            playerArea.appendChild(cardContainer);
            leftColumn.appendChild(playerArea);
        });
    }

    function getDragAfterElement(container, x) { /* ... (unchanged) ... */ const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')]; return draggableElements.reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = x - box.left - box.width / 2; if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; } }, { offset: Number.NEGATIVE_INFINITY }).element; }

    // --- Make modals draggable ---
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
    makeDraggable(document.getElementById('confirm-afk-modal'));
    makeDraggable(document.getElementById('discarded-wilds-modal'));

}); // End DOMContentLoaded