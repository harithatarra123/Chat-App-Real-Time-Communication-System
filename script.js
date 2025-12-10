const socket = io("http://localhost:5000");
let currentRoom = null;
let username = null;
let privateWith = null;
let typingTimeout = null;
let typingUsers = new Set();

const roomsListEl = document.getElementById('rooms-list');
const usersListEl = document.getElementById('users-list');
const createRoomBtn = document.getElementById('create-room-btn');
const newRoomName = document.getElementById('new-room-name');
const usernameInput = document.getElementById('username');
const registerBtn = document.getElementById('register-btn');
const messagesEl = document.getElementById('messages');
const typingEl = document.getElementById('typing');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('send-btn');
const currentRoomEl = document.getElementById('current-room');

createRoomBtn.addEventListener('click', async () => {
  const name = newRoomName.value.trim();
  if (!name) return alert('Enter room name');
  await fetch('/api/rooms', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
  newRoomName.value = '';
  loadRooms();
});

registerBtn.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  if (!val) return alert('Enter your name');
  username = val;
  socket.emit('register', username);
  alert('Name set: ' + username);
});

async function loadRooms(){
  const res = await fetch('/api/rooms');
  const rooms = await res.json();
  roomsListEl.innerHTML = '';
  rooms.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r.name;
    li.dataset.id = r.id;
    li.onclick = () => {
      // clear private state
      privateWith = null;
      joinRoom(r.id, r.name);
      document.querySelectorAll('#rooms-list li').forEach(x=>x.classList.remove('active'));
      li.classList.add('active');
    };
    roomsListEl.appendChild(li);
  });
}

async function loadUsers(){
  const res = await fetch('/api/users');
  const users = await res.json();
  usersListEl.innerHTML = '';
  users.forEach(u => {
    if (u === username) return;
    const li = document.createElement('li');
    li.textContent = u;
    li.onclick = () => {
      // open private chat
      privateWith = u;
      joinPrivate(u);
    };
    usersListEl.appendChild(li);
  });
}

function joinRoom(id, name){
  if (!username) return alert('Set your name first');
  currentRoom = id;
  privateWith = null;
  currentRoomEl.textContent = 'Room: ' + name;
  messagesEl.innerHTML = '';
  socket.emit('joinRoom', { roomId: id, username });
}

function joinPrivate(other){
  if (!username) return alert('Set your name first');
  currentRoom = null;
  privateWith = other;
  currentRoomEl.textContent = 'Private: ' + other;
  messagesEl.innerHTML = '';
  socket.emit('joinPrivate', { other });
}

socket.on('history', (messages) => {
  messagesEl.innerHTML = '';
  messages.forEach(m => addMessage(m, m.user === username));
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('privateHistory', ({ with: other, messages }) => {
  messagesEl.innerHTML = '';
  messages.forEach(m => addMessage(m, m.user === username));
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('message', (m) => { addMessage(m, m.user === username); messagesEl.scrollTop = messagesEl.scrollHeight; });
socket.on('privateMessage', (m) => { addMessage(m, m.user === username); messagesEl.scrollTop = messagesEl.scrollHeight; });

socket.on('roomUsers', (users) => {
  // can show per-room online if desired
});

socket.on('globalUsers', (users) => {
  loadUsers(); // refresh pull from server
});

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendMessage(); return; }
  // typing events
  if (privateWith) {
    socket.emit('typing', { isPrivate:true, room:null, user:username, to:privateWith });
    clearTypingTimeout();
  } else if (currentRoom) {
    socket.emit('typing', { isPrivate:false, room:currentRoom, user:username });
    clearTypingTimeout();
  }
});

function clearTypingTimeout(){
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (privateWith) socket.emit('stopTyping', { isPrivate:true, user:username, to:privateWith });
    else if (currentRoom) socket.emit('stopTyping', { isPrivate:false, user:username, room:currentRoom });
  }, 700);
}

socket.on('typing', ({ user }) => { showTyping(user); });
socket.on('stopTyping', ({ user }) => { hideTyping(user); });
socket.on('typingPrivate', ({ user }) => { showTyping(user); });
socket.on('stopTypingPrivate', ({ user }) => { hideTyping(user); });

function showTyping(user){
  typingUsers.add(user);
  renderTyping();
}
function hideTyping(user){
  typingUsers.delete(user);
  renderTyping();
}
function renderTyping(){
  if (typingUsers.size === 0) typingEl.textContent = '';
  else typingEl.textContent = Array.from(typingUsers).join(', ') + (typingUsers.size === 1 ? ' is typing...' : ' are typing...');
}

function sendMessage(){
  const text = msgInput.value.trim();
  if (!text) return;
  if (privateWith) {
    socket.emit('message', { isPrivate:true, user:username, to:privateWith, text });
  } else if (currentRoom) {
    socket.emit('message', { isPrivate:false, room:currentRoom, user:username, text });
  } else {
    return alert('Join a room or select a user for private chat');
  }
  msgInput.value = '';
  socket.emit('stopTyping', { isPrivate: !!privateWith, user:username, to:privateWith, room: currentRoom });
}

function addMessage(m, mine){
  const div = document.createElement('div');
  div.className = 'message ' + (mine ? 'me' : 'other');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = new Date(m.timestamp || Date.now()).toLocaleTimeString();
  meta.textContent = m.user + ' • ' + time;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = m.text;
  div.appendChild(meta);
  div.appendChild(text);
  messagesEl.appendChild(div);
}

/* initial */
loadRooms();
loadUsers();
