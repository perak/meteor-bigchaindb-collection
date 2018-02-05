const BDBDriver = require("bigchaindb-driver");
const WebSocket = require("ws");

export class BDBConnection {
	constructor(options = {}) {
		this._init(options);
	}

	_init(options = {}) {
		this.socket = null;

		this.options = {
			url: options ? options.url || "" : "",
			eventsUrl: options ? options.eventsUrl || "" : "",
			namespace: options ? options.namespace || "" : ""
		};

		this.connection = null;
		this.collections = {};
	}

	connect(options = {}, cb) {
		if(options) {
			this._init(options);
		}

		if(!this.options.url) {
			let errorMsg = "ERROR: BigchainDB API URL is not set.";
			if(cb) {
				cb(new Error(errorMsg));
			} else {
				console.log(errorMsg);
			}
		}

		this.connection = new BDBDriver.Connection(this.options.url);

		if(this.options.eventsUrl) {
			this.listenEvents(cb);
		}
	}

	registerCollection(collection) {
		let coll = null;
		if(typeof collection == "string") {
			coll = global[collection];
		} else {
			coll = collection;
		}
		if(coll) {
			coll.bdbConnection = this;
			this.collections[coll._name] = coll;
		}
	}

	listenEvents(cb) {
		let self = this;

		try {
			this.socket = new WebSocket(this.options.eventsUrl);
		} catch(e) {
			if(cb) {
				cb(e);
			} else {
				console.log(e);
			}
			return;
		}

		this.socket.onmessage = Meteor.bindEnvironment((e) => {
			let data = {};
			try {
				data = JSON.parse(e.data);
			} catch(err) {
				if(cb) {
					cb(err);
				} else {
					console.log(err);
				}
				return;
			}

			self.connection.getTransaction(data.transaction_id).then(Meteor.bindEnvironment((trans) => {
				let record = trans && trans.asset && trans.asset.data ? trans.asset.data : null;
				if(record) {
					let collection = null;
					for(let key in self.collections) {
						let coll = self.collections[key];
						let nsField = coll._namespaceField;
						let ns = coll._namespace ? coll._namespace : self.options.namespace + "." + coll._name;
						if(record[nsField] == ns) {
							collection = coll;
							break;
						}
					}

					if(collection) {
						let found = collection.findOne({ $or: [ { _id: record._id }, { _transactionId: trans.id } ] });
						if(!found) {
							record._transactionId = trans.id;
							record._transactionStatus = "ok";
							collection.insert(record);
						}
					}
				}
			}));
		});

		this.socket.onopen = function(e) {
		};

		this.socket.onerror = function(e) {
			console.log("BigchainDB WebSocket error. Type: \"" + e.type + "\".");
		};

		this.socket.onclose = function(e) {
			console.log("BigchainDB WebSocket connection closed. Code: " + e.code + ", reason: \"" + e.reason + "\".", e.code, e.reason);
		};
	}
};

export class BDBCollection extends Mongo.Collection {
	constructor(name, options) {
		super(name, options);

		this._namespaceField = options ? options.namespaceField || "_namespace" : "_namespace";
		this._namespace = options ? options.namespace : null;
	}

	insert(doc, callback, options = { publicKey: "", privateKey: "" }) {
		let self = this;

		if(Meteor.isServer && this.bdbConnection) {
			if(doc._transactionId) {
				return super.insert.apply(this, arguments);
			}

			let payload = JSON.parse(JSON.stringify(doc));
			payload[this._namespaceField] = this._namespace ? this._namespace : this.bdbConnection.options.namespace + "." + this._name;

			doc._transactionId = null;
			doc._transactionStatus = "pending";

			super.insert(doc, (e, r) => {
				if(e) {
					throw e;
				}

				if(callback) {
					callback(e, r);
				}

				// Construct a transaction payload
				payload._id = r;
				const tx = BDBDriver.Transaction.makeCreateTransaction(
					payload,
					null,
					[
						BDBDriver.Transaction.makeOutput(BDBDriver.Transaction.makeEd25519Condition(options.publicKey))
					],
					options.publicKey
				);

				const txSigned = BDBDriver.Transaction.signTransaction(tx, options.privateKey);

				self.bdbConnection.connection.postTransaction(txSigned).then(() => {
					self.bdbConnection.connection.pollStatusAndFetchTransaction(txSigned.id).then((retrievedTx) => {
						self.update({ _id: r }, { $set: { _transactionId: retrievedTx.id, _transactionStatus: "ok" } });
					});
				});
			});
		} else {
			return super.insert.apply(this, arguments);
		}
	}
}
