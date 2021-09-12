const {ethers} = require("ethers")
const fs = require('fs')
const mkdirp = require('mkdirp')

const Step = 5000
const MaxBlockNum = 999999999999
const PrePath = './seps20/'
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

let preBlockNum = 200000

let filter = {
    topics: [
        ethers.utils.id("Transfer(address,address,uint256)"),
    ]
}

let sep20s = new Map()

async function work() {
    let blockNum = await Provider.getBlockNumber()
    console.log('latest block: ' + blockNum)
    while (preBlockNum < blockNum) {
        filter.fromBlock = preBlockNum
        filter.toBlock = Math.min(preBlockNum + Step, blockNum)
        console.log(`scan SEP20s between ${filter.fromBlock} and ${filter.toBlock}`)

        let logs = await Provider.getLogs(filter)
        logs.forEach(log => sep20s.set(log.address, Math.min(sep20s.has(log.address) ? sep20s.get(log.address) : MaxBlockNum, log.blockNumber)))
        preBlockNum = filter.toBlock
    }

    for (let address of sep20s.keys()) {
        console.log('scanning ' + address);
        await getSep20Info(address, sep20s[address], blockNum)
    }
    console.log('finish scanning!')
}

async function getSep20Info(sep20Address, createdBlockNum, latestBlockNum) {
    let accounts = new Map()
    let startBlockNum = 200000
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
    const decimals = await sep20Contract.decimals()
    const symbol = await sep20Contract.symbol()
    const name = await sep20Contract.name()
    const totalSupply = await sep20Contract.totalSupply()

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
    accounts = new Map(accountArray.map(i=>[i[0], i[1]]))

    let title = `name:${name}\nsymbol:${symbol}\naddress:${sep20Address}\ndecimals:${decimals}\ntotalSupply:${ethers.utils.formatUnits(totalSupply, decimals)}\naccount amount:${accounts.size}\naccounts:\n`
    let path = PrePath + name.replace(' ', '-') + sep20Address
    await fs.writeFileSync(path, title+ JSON.stringify([...accounts], null, " "))
    console.log(`write ${name} in file`)
}

async function main() {
    await mkdirp(PrePath)
    await work()
}

main()