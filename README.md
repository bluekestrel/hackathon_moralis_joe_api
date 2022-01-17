# Trader Joe API

API that gives various information about Trader Joe pools, farms, Banker Joe, staking, token prices,
and the JOE token (used by coingecko)

---

## Installing Dependencies
This project uses yarn to manage dependencies; to install all necessary production and development dependencies, run:
```
yarn
```

---

## Configuring the Server
The API server uses a config file which provides contract addresses, default RPC endpoints,
wallet addresses, etc. The file is called `config.js` and is located at the base of this repository.

Additionally, there is a .env file which should contain an RPC endpoint to use in production and a
Moralis API Key (used by some routes to request past transactions). The .env file should look like the following:
```
AVAX_RPC=<RPC_ENDPOINT>
MORALIS_API_KEY=<API_KEY>
```

---

## Running the Server
To use the default mainnet configuration, run: 
```
yarn start
```

If you want to run the server with a different config, run:
```
yarn start -n <network_name>
```
Where `<network_name>` corresponds to the name of a configuration object key in `config.js`

If developing locally, run:
```
yarn start-dev
```
This will spin up a watchdog thread to auto-reload the API server each time a file is saved.

---

## Swagger Documentation


Each of the API routes has been documented and setup to work with swagger. Navigate to `https://api.traderjoexyz.com/docs` or `http://localhost:3000/docs` (if running server locally) to view the swagger documentation for each route.

The swagger docs use the yaml files located in `/docs` of the repository. The actual yaml file used by the server is `joe-api.yaml` which gets auto-generated after running the command:
```
yarn docs-gen
```
Do NOT edit the `joe-api.yaml` file directly as it gets blown away by the above command. Instead update the corresponding route's yaml file, and if necessary add any additional routes to the main swagger config file `swagger.yaml`

---

## License

[MIT](LICENSE)
