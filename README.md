# Meteor BigchainDB Collection

**Use BigchainDB in your Meteor application just like you are using Mongo**


### WARNING: this is just an experiment!


## How it works?

Data is imediatelly written into your normal Mongo database plus it is sent as an transaction to BigchainDB. After transaction is confirmed by BigchainDB, document is updated with transaction ID and status is changed from "pending" to "ok".

This package is using BigchainDB's event stream to listen for successfull transactions. Data written directly to BigchainDB (by another application or whatever) is detected and written to your application's Mongo database.

In short, Mongo acts as a buffer between your application and BigchainDB. 


## Usage

**Add this package to your Meteor application:**

```
meteor npm install --save meteor-bigchaindb-collection
```


**Add following to your Meteor `settings.json`:**

```
{
	"bigchaindb": {
		"url": "http://localhost:9984/api/v1/",
		"eventsUrl": "ws://0.0.0.0:9985/api/v1/streams/valid_transactions",
		"namespace": "YOUR_APP_UNIQUE_ID"
	}
}

```

- `url` is URL to BigchainDB server's REST API.
- `eventsUrl` is URL to BigchainDB's event stream websocket.
- `namespace` is your application's unique id. Can be any string.


**Define your collections in both client and server scope:**

```
import {BDBCollection} from "meteor-bigchaindb-collection";

export const MyCollection = new BDBCollection("my_collection");
```


**In Meteor server's startup, create BDB connection and register all BDB collections you have in the app:**

```
import { BDBConnection } from "bigchaindb-collection";

import { MyCollection } from "path to file where you defined your collection";

Meteor.startup(function() {

	let BDBC = new BDBConnection();
	
	BDBC.connect({
		url: Meteor.settings.bigchaindb.url,
		eventsUrl: Meteor.settings.bigchaindb.eventsUrl,
		namespace: Meteor.settings.bigchaindb.namespace
	});

	BDBC.registerCollection(MyCollection);
	
});

```


**Don't forget to start your application with settings.json**

```
meteor --settings settings.json
```


**And use collection as you normally do, but perform inserts server-side only and provide BDB keys as third argument to insert:**

```
let publicKey = "....";
let privateKey = "....";

MyCollection.insert({ hello: "world" }, null, { publicKey: publicKey, privateKey: privateKey });

console.log(MyCollection.find({}).fetch());
```

*You are inside method here, so assuming user's keys are stored in "users" collection, you can get user (caller) with: `users.findOne({ _id: this.userId });` and access his private and public key. Or, if keys are fixed at app level, you can read them from Meteor.settings (or whatever)*



**You'll notice two additional fields in your document:**

- `_transactionId` - BigchainDB transaction ID. Initially it is null until transaction is confirmed.

- `_transactionStatus` - Initially it is `"pending"` and changes to `"ok"` after transaction is confirmed.


**That all folks**

Enjoy!
