var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var express = require('express');
var Message = require(__dirname + '/constant.js').Message;
var WolfGame = require(__dirname + '/constant.js').Game;

app.use(express.static(__dirname))

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});


// Game States.
var game_index = 1;
var games = {};
var game_steps = [WolfGame.WOLF, WolfGame.WITCH, WolfGame.SEER, WolfGame.SAVIOR, WolfGame.HUNTER, WolfGame.ROUND_END];

io.on('connection', function(socket){
console.log('a user connected');
  socket.on('chat message', function(msg){
    io.emit('chat message', msg);
  });

  socket.on('disconnect', function(message) {
	for (var i in games) {
		var pos = games[i].findPositionForIp(socket.id);
		if (pos != -1) {
			games[i].updateHost(false, "玩家逃跑: " + pos);
			return;
		}
	}
  });

  socket.on(Message.CREATE, function(msg) {
		var playerId = socket.id;
		if (playerAlreadyInGame(playerId)) {
			socket.emit(Message.ERROR, 'You are already in game. Failed to create new game');
			return;
		}

		var newGame = new Game(game_index, socket.id, msg);
		console.log('create room size: '  + newGame.size);
		games[game_index] = newGame;
		socket.join(newGame.room);
		roomMsg = {}
		roomMsg[Message.INDEX] = game_index ;
		roomMsg[Message.SIZE] = newGame.size;
		roomMsg[Message.PLAYERINDEX] = 1;
		socket.emit(Message.CREATE, roomMsg);
	  	++game_index;
		
	});

	socket.on(Message.JOIN, function(msg) {
		console.log('request to join room ' + msg[Message.ROOMID] + ' with id ' + msg[Message.PLAYERINDEX]);
		var playerId = socket.id;
		if (playerAlreadyInGame(playerId)) {
			socket.emit(Message.ERROR, 'You are already in game. Failed to join new game');
			return;
		}
		var roomId = msg[Message.ROOMID];
		if (!(roomId in games)) {
			socket.emit(Message.ERROR, '房间号' + roomId + '不存在');
			return;
		}

		
		var game = games[roomId];
		var joinResult = game.join(playerId, msg[Message.PLAYERINDEX]);
		if (joinResult != '') {
			socket.emit(Message.ERROR, joinResult);
		} else {				
			socket.join(game.room);
			roomMsg = {}
			roomMsg[Message.INDEX] = roomId;
			roomMsg[Message.SIZE] = game.size;
			roomMsg[Message.PLAYERINDEX] = msg[Message.PLAYERINDEX];
			socket.emit(Message.JOIN, roomMsg);
		}

		if (game.ready()) {
			io.to(game.room).emit(Message.INFO, '房间已满， 等待房主开始...');
			io.to(game.hostId).emit(Message.READY);
		}
		
	});

	socket.on(Message.START, function(msg) {
		if (msg in games) {
			var game = games[msg];
			game.start();
		} else {
			socket.emit(Message.ERROR, "开始游戏的房间" + msg + '不存在');
		}
	});

	socket.on(Message.NEXT, function(msg) {
		if (msg in games) {
			games[msg].next();
		}
	});

	socket.on(Message.REPORT, function(msg) {
		if (msg in games) {
			games[msg].report();
		}
	});

	socket.on(Message.RESEND, function(msg) {
		if (msg in games) {
			games[msg].resend();
		}
	});

	socket.on(Message.WOLF_ROUND, function(msg) {
		console.log(msg);
		if (msg[WolfGame.INDEX] in games) {
			var game = games[msg[WolfGame.INDEX]];
			game.wolfRoundEnd(msg[WolfGame.KILL]);
		}
	});

	socket.on(Message.WITCH_ROUND, function(msg) {
		console.log(msg);
		if (msg[WolfGame.INDEX] in games) {
			games[msg[WolfGame.INDEX]].witchRoundEnd(msg);
		}
	});

	socket.on(Message.SEER_ROUND, function(idx) {
		if (idx in games) {
			games[idx].seerRoundEnd();
		}
	});

	socket.on(Message.SAVIOR_ROUND, function(msg) {
		if (msg[WolfGame.INDEX] in games) {
			var game = games[msg[WolfGame.INDEX]];
			game.saviorRoundEnd(msg);
		}
	});
});



http.listen(3000, function(){
  console.log('listening on *:3000');
});

function playerAlreadyInGame(id) {
	for (var gameId in games) {
		var usernames = games[gameId].usernames;
		for (var i = 0; i < usernames.length; ++i) {
			if (usernames[i] == id) {
				return true;
			}
		}
	}
	return false;
}

function Game(gameIndex, hostId, config) {
	this.usernames = new Array();
	this.hostId = hostId;
	this.gameIndex = gameIndex;
	this.usernames.push(hostId);
	this.playerMap = {};
	this.playerMap[1] = hostId;
	this.room = 'room_' + gameIndex;
	this.config = config;
	var size = 0;
	for (var key in config) {
		size += config[key];
	}
	this.size = size;
	this.step = 0;
	this.saviorSaved = -1;
	this.witch_kill = -1;
	this.saved = false;
}

Game.prototype.report = function() {
	this.updateHost(false, '有人举报。请确认');
};

Game.prototype.resend = function() {
	this.step = this.lastStep;
	this.next();
};

Game.prototype.join = function(username, playerIndex) {
	if (playerIndex < 1 || playerIndex > this.size) {
		return '无效的玩家位置' + playerIndex;
	}
	if (playerIndex in this.playerMap) {
		return '玩家位置' + playerIndex + '已经被占用';
	}

	this.usernames.push(username);
	this.playerMap[playerIndex] = username;
	return '';
};

Game.prototype.ready = function() {
	return this.size == Object.keys(this.playerMap).length;
	// return true;
};

Game.prototype.start = function() {
	console.log('Start game for game ' + this.gameIndex);
	this.characters = new Array();
	for (var character in WolfGame) {
		if (WolfGame[character] in this.config) {
			for (var i = 0; i < this.config[WolfGame[character]]; ++i) {
				this.characters.push(WolfGame[character]);
			}
		}
	}
	for (var i = 0; i < 20; ++i) {
		shuffle(this.characters);
	}
	// TODO: shuffle.
	console.log(this.characters);
	this.next();
};

Game.prototype.wolfRound = function() {
	var firstWolf = true;
	for (var i = 0; i < this.characters.length; ++i) {
		var startMsg = {}
		startMsg[Message.CHARACTER] = this.characters[i];
		if (firstWolf && this.characters[i] == WolfGame.WOLF) {
			firstWolf = false;
			startMsg[Message.EXTRA] = this.size;
		}
		console.log(startMsg);
		io.to(this.playerMap[i + 1]).emit(Message.START, startMsg);
	}
	this.lastStep = this.step;
	++this.step;
};

Game.prototype.wolfRoundEnd = function(killIndex) {
	this.killed = killIndex;
	console.log(this.killed);
	for (var i = 0; i < this.characters.length; ++i) {
		if (this.characters[i] == WolfGame.WOLF) {
			io.to(this.playerMap[i + 1]).emit(Message.WOLF_ROUND, killIndex);
		}
	}
	this.updateHost(true, '狼人行动完成, 请确认下一步');
};

Game.prototype.witchRound = function() {
	var ip = this.findCharacterIp(WolfGame.WITCH);
	io.to(ip).emit(Message.WITCH_ROUND, this.killed);
	this.lastStep = this.step;
	++this.step;
};

Game.prototype.witchRoundEnd = function(msg) {
	if (WolfGame.WITCH_SAVE in msg) {
		this.saved = msg[WolfGame.WITCH_SAVE];
		this.witch_kill = -1;
	} else if (WolfGame.WITCH_KILL in msg) {
		this.witch_kill = msg[WolfGame.WITCH_KILL];
		this.saved = false;
	}
	this.updateHost(true, '女巫行动完成， 请确认下一步');
};

Game.prototype.seerRound = function() {
	var ip = this.findCharacterIp(WolfGame.SEER);
	io.to(ip).emit(Message.SEER_ROUND, this.characters);
	this.lastStep = this.step;
	++this.step;
};

Game.prototype.seerRoundEnd = function() {
	this.updateHost(true, '预言家行动完成. 请确认下一步');
};

Game.prototype.saviorRound = function() {
	var ip = this.findCharacterIp(WolfGame.SAVIOR);
	io.to(ip).emit(Message.SAVIOR_ROUND);
	this.lastStep = this.step;
	++this.step;
};

Game.prototype.saviorRoundEnd = function(msg) {
	if (WolfGame.SAVIOR_SAVE in msg) {
		this.saviorSaved = msg[WolfGame.SAVIOR_SAVE];
	} else {
		this.saviorSaved = -1;
	}
	this.updateHost(true, '守卫行动完成. 请确认下一步');
};

Game.prototype.hunterRound = function() {
	var ip = this.findCharacterIp(WolfGame.HUNTER);
	var good = this.findCharacterPlayerPosition(WolfGame.HUNTER) != this.witch_kill;
	io.to(ip).emit(Message.HUNTER_ROUND, good);
	this.lastStep = this.step;
	++this.step;
	this.updateHost(true, '猎人消息已发送. 点击下一步获得结果.');
};

Game.prototype.roundEnd = function() {
	var dead = new Array();
	if (this.witch_kill != -1) {
		dead.push(this.witch_kill);
	}
	if (this.saviorSaved != -1 && this.saviorSaved == this.killed) {
		if (this.saved) {
			dead.push(this.killed);
		}
	}
	if (this.saviorSaved == -1 && !this.saved) {
		dead.push(this.killed);
	}
	dead.sort();
	io.to(this.hostId).emit(Message.ROUND_END, dead);
};

Game.prototype.next = function() {
	while (this.step < game_steps.length) {
		var cur_step = game_steps[this.step];
		if (!(cur_step in this.config) && cur_step != WolfGame.ROUND_END) {
			++this.step;
			continue;
		}
		if (cur_step == WolfGame.WOLF) {
			this.wolfRound();
			break;
		} else if (cur_step == WolfGame.WITCH) {
			this.witchRound();
			break;
		} else if (cur_step == WolfGame.SEER) {
			this.seerRound();
			break;
		} else if (cur_step == WolfGame.SAVIOR) {
			this.saviorRound();
			break;
		} else if (cur_step == WolfGame.HUNTER) {
			this.hunterRound();
			break;
		} else if (cur_step == WolfGame.ROUND_END) {
			this.roundEnd();
			break;
		} else {
			console.log("Error. Unknown round.");
		}
	}
}

Game.prototype.updateHost = function(enable, msg) {
	nextMsg = {}
	nextMsg[Message.ENABLE_HOST] = enable;
	nextMsg[Message.INFO] = msg;
	io.to(this.hostId).emit(Message.NEXT, nextMsg);
};

Game.prototype.findCharacterPlayerPosition = function(char) {
	for (var i = 0; i < this.characters.length; ++i) {
		if (this.characters[i] == char) {
			return i + 1;
		}
	}
	return -1;
};

Game.prototype.findCharacterIp = function(char) {
	for (var i = 0; i < this.characters.length; ++i) {
		if (this.characters[i] == char) {
			return this.playerMap[i + 1];
		}
	}
	return -1;
};

Game.prototype.findPositionForIp = function(ip) {
	for (var i in this.playerMap) {
		if (this.playerMap[i] == ip) {
			return i;
		}
	}
	return -1;
};

function shuffle(a) {
    var j, x, i;
    for (i = a.length; i; i--) {
        j = Math.floor(Math.random() * i);
        x = a[i - 1];
        a[i - 1] = a[j];
        a[j] = x;
    }
}