// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Every shop order gets its own deposit address: a Deposit at a CREATE2 address fixed by the order's salt.
// Nothing is deployed until money moves: the address can take USDC (any amount, any number of sends) before
// it has code. sweep() deploys it if needed and sends what it holds to the shop's Safe, and only there:
// anyone may call it, nobody can send the money anywhere else. A wrong token or plain ETH sweeps the same way.
// Anything else sent by mistake (an NFT, a token that needs some other call): the Safe itself can make the
// deposit do any call (exec), so nothing sent there is ever stuck.

/// One order's deposit address. Sends everything it holds to `shop`, nowhere else.
contract Deposit {
    address payable public immutable shop;
    address public immutable factory;   // WedgieDeposits, which passes on the Safe's exec

    constructor(address payable s) {
        shop = s;
        factory = msg.sender;
    }

    function sweep(address token) external {
        if (token == address(0)) {
            (bool ok,) = shop.call{value: address(this).balance}("");
            require(ok, "eth");
            return;
        }
        (, bytes memory b) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));   // balanceOf
        uint256 n = abi.decode(b, (uint256));
        (bool sent, bytes memory r) = token.call(abi.encodeWithSelector(0xa9059cbb, shop, n));      // transfer
        require(sent && (r.length == 0 || abi.decode(r, (bool))), "transfer");   // tokens that return nothing too
    }

    /// Only the Safe: any call from this address, to get out whatever sweep can't.
    function exec(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == shop || msg.sender == factory, "shop only");   // the factory checks it's the Safe
        (bool ok, bytes memory r) = to.call{value: value}(data);
        require(ok, "exec");
        return r;
    }

    receive() external payable {}

    // NFTs sent with safeTransferFrom: take them (exec gets them out)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }
}

/// Deployed once per chain (same address on every chain: the deterministic deployer, salt 0).
contract WedgieDeposits {
    address payable public immutable shop;

    constructor(address payable s) {
        shop = s;
    }

    function addressOf(bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(type(Deposit).creationCode, abi.encode(shop)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }

    function sweep(bytes32 salt, address token) public {
        address a = addressOf(salt);
        if (a.code.length == 0) new Deposit{salt: salt}(shop);
        Deposit(payable(a)).sweep(token);
    }

    /// Only the Safe: deploy the order's deposit if needed and make it do any call (Deposit.exec).
    function exec(bytes32 salt, address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == shop, "shop only");
        address a = addressOf(salt);
        if (a.code.length == 0) new Deposit{salt: salt}(shop);
        return Deposit(payable(a)).exec(to, value, data);
    }

    function sweepMany(bytes32[] calldata salts, address token) external {
        for (uint256 i = 0; i < salts.length; i++) sweep(salts[i], token);
    }
}
