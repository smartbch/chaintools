const {ethers} = require("ethers")
const fs = require('fs')
const mkdirp = require('mkdirp')

const Step = 1000
const MaxBlockNum = 999999999999
const ConfigPath = 'config.txt'
const PrePath = './seps20/'
const NewSep20sPath = 'new_sep20s.txt'
const HotTokenHolderThreshold = 50
const Provider = new ethers.providers.JsonRpcProvider('http://18.138.237.114:8545');
const SEP20ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function transfer(address recipient, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)"]

let genesisBlockNum = 200000

let filter = {
    topics: [
        ethers.utils.id("Transfer(address,address,uint256)"),
    ]
}

let sep20s = new Map()

async function work() {
    let blockNum = await Provider.getBlockNumber()
    console.log('latest block: ' + blockNum)
    let config = {}
    try {
        const jsonString = await fs.readFileSync(ConfigPath)
        config = JSON.parse(jsonString)
    } catch (err) {
        console.log(err)
        config.previousBlockNumber = 550000
        await fs.writeFileSync(ConfigPath, JSON.stringify(config))
    }
    let preBlockNum = config.previousBlockNumber

    let newSep20s = new Map()
    while (preBlockNum < blockNum) {
        filter.fromBlock = preBlockNum
        filter.toBlock = Math.min(preBlockNum + Step, blockNum)
        console.log(`scan SEP20s between ${filter.fromBlock} and ${filter.toBlock}`)

        let logs = await Provider.getLogs(filter)
        logs.forEach(log => newSep20s.set(log.address, Math.min(newSep20s.has(log.address) ? newSep20s.get(log.address) : MaxBlockNum, log.blockNumber)))
        preBlockNum = filter.toBlock
    }

    while (genesisBlockNum < config.previousBlockNumber) {
        filter.fromBlock = genesisBlockNum
        filter.toBlock = Math.min(genesisBlockNum + Step, config.previousBlockNumber)
        console.log(`scan SEP20s between ${filter.fromBlock} and ${filter.toBlock}`)

        let logs = await Provider.getLogs(filter)
        logs.forEach(log => sep20s.set(log.address, Math.min(sep20s.has(log.address) ? sep20s.get(log.address) : MaxBlockNum, log.blockNumber)))
        genesisBlockNum = filter.toBlock
    }
    for (let address of newSep20s.keys()) {
        console.log('scanning new seps20 ' + address);
        await getSep20Info(address, newSep20s.get(address), blockNum, true)
    }
    for (let address of sep20s.keys()) {
        console.log('scanning ' + address);
        await getSep20Info(address, sep20s.get(address), blockNum, false)
    }
    config.previousBlockNumber = blockNum
    await fs.writeFileSync(ConfigPath, JSON.stringify(config))
    console.log('finish scanning!')
}

async function getSep20Info(sep20Address, createdBlockNum, latestBlockNum, isNew) {
    const createdBlock = await Provider.getBlock(createdBlockNum)
    const createdTimeStr = new Date(createdBlock.timestamp * 1000).toLocaleDateString()
    let accounts = new Map()
    let startBlockNum = createdBlockNum
    let filter = {
        address: sep20Address,
        topics: [
            ethers.utils.id("Transfer(address,address,uint256)"),
        ]
    }
    while (startBlockNum < latestBlockNum) {
        filter.fromBlock = startBlockNum
        filter.toBlock = Math.min(startBlockNum + Step, latestBlockNum)
        const logs = await Provider.getLogs(filter)
        logs.forEach(log => {
            accounts.set("0x" + log.topics[1].substr(26), 0)
            accounts.set("0x" + log.topics[2].substr(26), 0)
        })
        startBlockNum = filter.toBlock
    }

    const sep20Contract = new ethers.Contract(sep20Address, SEP20ABI, Provider);
    let decimals
    try {
        decimals = await sep20Contract.decimals()
    } catch (error) {
        console.log(error)
        return
    }
    let name
    try {
        name = await sep20Contract.name()
    } catch (error) {
        console.log(error)
        return
    }
    let symbol
    try {
        symbol = await sep20Contract.symbol()
    } catch (error) {
        console.log(error)
        return
    }
    let totalSupply
    try {
        totalSupply = await sep20Contract.totalSupply()
    } catch (error) {
        console.log(error)
        return
    }
    let zeroBalanceAddress = []
    for (let address of accounts.keys()) {
        let balance = await sep20Contract.balanceOf(address)
        if (balance.isZero()) {
            zeroBalanceAddress.push(address)
        } else {
            accounts.set(address, ethers.utils.formatUnits(balance, decimals))
        }
    }

    zeroBalanceAddress.forEach(address => accounts.delete(address))

    let accountArray = Array.from(accounts)
    accountArray.sort((a, b) => b[1] - a[1])
    accounts = new Map(accountArray.map(i => [i[0], i[1]]))

    const currTimeStr = new Date(Date.now()).toLocaleDateString()
    let title = `scan time:${currTimeStr}\nname:${name}\nsymbol:${symbol}\naddress:${sep20Address}\ndecimals:${decimals}\ntotalSupply:${ethers.utils.formatUnits(totalSupply, decimals)}\ncreated time:${createdTimeStr}\naccount amount:${accounts.size}\naccounts:\n`
    let path = PrePath + symbol.replace(' ', '-') + sep20Address
    let content = ""
    for (let address of accounts.keys()) {
        content += `  - ${address}: ${accounts.get(address)}\n`
    }
    await fs.writeFileSync(path, title + content)
    console.log(`write ${name} in file`)

    if (isNew) {
        console.log('newToken, size is:', accounts.size)
    }
    if (isNew && accounts.size > HotTokenHolderThreshold) {
        let content = `scan time:${currTimeStr},name:${name},symbol:${symbol},address:${sep20Address},totalSupply:${ethers.utils.formatUnits(totalSupply, decimals)},account amount:${accounts.size}\n`
        await fs.appendFileSync(NewSep20sPath, content)
    }
}

async function main() {
    await mkdirp(PrePath)
    await work()
}

main()
