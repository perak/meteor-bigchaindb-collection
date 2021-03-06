"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BDBDriver = require("bigchaindb-driver");
var WebSocket = require("ws");
var bip39 = require("bip39");

var BDBConnection = exports.BDBConnection = function () {
	function BDBConnection() {
		var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

		_classCallCheck(this, BDBConnection);

		this.collections = {};
		this.transactionCallbacks = [];

		this._init(options);
	}

	_createClass(BDBConnection, [{
		key: "_init",
		value: function _init() {
			var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

			this.socket = null;

			this.options = {
				url: options ? options.url || "" : "",
				eventsUrl: options ? options.eventsUrl || "" : "",
				namespace: options ? options.namespace || "" : "",
				appId: options ? options.appId || "" : "",
				appKey: options ? options.appKey || "" : ""
			};

			this.connection = null;
		}
	}, {
		key: "connect",
		value: function connect() {
			var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];
			var cb = arguments[1];

			if (options) {
				this._init(options);
			}

			if (!this.options.url) {
				var errorMsg = "ERROR: BigchainDB API URL is not set.";
				if (cb) {
					cb(new Error(errorMsg));
				} else {
					console.log(errorMsg);
				}
			}

			var headers = {};
			if (this.options.appId) {
				headers.app_id = this.options.appId;
			}
			if (this.options.appKey) {
				headers.app_key = this.options.appKey;
			}

			this.connection = new BDBDriver.Connection(this.options.url, headers);

			if (this.options.eventsUrl) {
				this.listenEvents(cb);
			}
		}
	}, {
		key: "registerCollection",
		value: function registerCollection(collection) {
			var coll = null;
			if (typeof collection == "string") {
				coll = global[collection];
			} else {
				coll = collection;
			}
			if (coll) {
				coll.bdbConnection = this;
				this.collections[coll._name] = coll;
			}
		}
	}, {
		key: "listenEvents",
		value: function listenEvents(cb) {
			var self = this;

			try {
				this.socket = new WebSocket(this.options.eventsUrl);
			} catch (e) {
				if (cb) {
					cb(e);
				} else {
					console.log(e);
				}
				return;
			}

			this.socket.onmessage = Meteor.bindEnvironment(function (e) {
				var data = {};
				try {
					data = JSON.parse(e.data);
				} catch (err) {
					if (cb) {
						cb(err);
					} else {
						console.log(err);
					}
					return;
				}

				self.connection.getTransaction(data.transaction_id).then(Meteor.bindEnvironment(function (trans) {
					var record = trans && trans.asset && trans.asset.data ? trans.asset.data : null;
					if (record) {
						var collection = null;
						for (var key in self.collections) {
							var coll = self.collections[key];
							var nsField = coll._namespaceField;
							var ns = coll._namespace ? coll._namespace : self.options.namespace + "." + coll._name;
							if (record[nsField] == ns) {
								collection = coll;
								break;
							}
						}

						if (collection) {
							var found = collection.findOne({ $or: [{ _id: record._id }, { _transactionId: trans.id }] });
							if (!found) {
								record._transactionId = trans.id;
								record._transactionStatus = "ok";
								collection.insert(record);
							}
						}
					}

					self.transactionCallbacks.map(function (transactionCallback) {
						transactionCallback(data, trans);
					});
				}));
			});

			this.socket.onopen = function (e) {};

			this.socket.onerror = function (e) {
				console.log("BigchainDB WebSocket error. Type: \"" + e.type + "\".");
			};

			this.socket.onclose = function (e) {
				console.log("BigchainDB WebSocket connection closed. Code: " + e.code + ", reason: \"" + e.reason + "\".", e.code, e.reason);
			};
		}
	}, {
		key: "keypairFromPassword",
		value: function keypairFromPassword(password) {
			return new BDBDriver.Ed25519Keypair(bip39.mnemonicToSeed(password).slice(0, 32));
		}
	}, {
		key: "createTransaction",
		value: function createTransaction(data, publicKey, privateKey, cb) {
			var self = this;
			var tx = BDBDriver.Transaction.makeCreateTransaction(data, null, [BDBDriver.Transaction.makeOutput(BDBDriver.Transaction.makeEd25519Condition(publicKey))], publicKey);

			var txSigned = BDBDriver.Transaction.signTransaction(tx, privateKey);

			self.connection.postTransaction(txSigned).then(function () {
				self.connection.pollStatusAndFetchTransaction(txSigned.id).then(function (retrievedTx) {
					if (cb) {
						cb(retrievedTx);
					}
				});
			});
		}
	}, {
		key: "onTransaction",
		value: function onTransaction(cb) {
			this.transactionCallbacks.push(cb);
		}
	}]);

	return BDBConnection;
}();

;

var BDBCollection = exports.BDBCollection = function (_Mongo$Collection) {
	_inherits(BDBCollection, _Mongo$Collection);

	function BDBCollection(name, options) {
		_classCallCheck(this, BDBCollection);

		var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(BDBCollection).call(this, name, options));

		_this._namespaceField = options ? options.namespaceField || "_namespace" : "_namespace";
		_this._namespace = options ? options.namespace : null;
		return _this;
	}

	_createClass(BDBCollection, [{
		key: "insert",
		value: function insert(doc, callback) {
			var _this2 = this,
			    _arguments = arguments;

			var options = arguments.length <= 2 || arguments[2] === undefined ? { publicKey: "", privateKey: "" } : arguments[2];

			var self = this;
			if (Meteor.isServer && this.bdbConnection) {
				var _ret = function () {
					if (doc._transactionId) {
						return {
							v: _get(Object.getPrototypeOf(BDBCollection.prototype), "insert", _this2).apply(_this2, _arguments)
						};
					}

					var payload = JSON.parse(JSON.stringify(doc));
					payload[_this2._namespaceField] = _this2._namespace ? _this2._namespace : _this2.bdbConnection.options.namespace + "." + _this2._name;

					doc._transactionId = null;
					doc._transactionStatus = "pending";

					_get(Object.getPrototypeOf(BDBCollection.prototype), "insert", _this2).call(_this2, doc, function (e, r) {
						if (e) {
							throw e;
						}

						if (callback) {
							callback(e, r);
						}

						// Construct a transaction payload
						payload._id = r;
						var tx = BDBDriver.Transaction.makeCreateTransaction(payload, null, [BDBDriver.Transaction.makeOutput(BDBDriver.Transaction.makeEd25519Condition(options.publicKey))], options.publicKey);

						var txSigned = BDBDriver.Transaction.signTransaction(tx, options.privateKey);

						self.bdbConnection.connection.postTransaction(txSigned).then(function () {
							self.bdbConnection.connection.pollStatusAndFetchTransaction(txSigned.id).then(function (retrievedTx) {
								self.update({ _id: r }, { $set: { _transactionId: retrievedTx.id, _transactionStatus: "ok" } });
							});
						});
					});
				}();

				if ((typeof _ret === "undefined" ? "undefined" : _typeof(_ret)) === "object") return _ret.v;
			} else {
				return _get(Object.getPrototypeOf(BDBCollection.prototype), "insert", this).apply(this, arguments);
			}
		}
	}]);

	return BDBCollection;
}(Mongo.Collection);