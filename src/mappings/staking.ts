import { BigInt, Address, BigDecimal, Bytes, ipfs, log } from '@graphprotocol/graph-ts'
import {
  StakeDeposited,
  StakeWithdrawn,
  StakeLocked,
  StakeSlashed,
  AllocationCreated,
  AllocationClosed,
  RebateClaimed,
  ParameterUpdated,
  Staking,
  SetOperator,
  StakeDelegated,
  StakeDelegatedLocked,
  StakeDelegatedWithdrawn,
  AllocationCollected,
  DelegationParametersUpdated,
} from '../types/Staking/Staking'
import {
  Indexer,
  Allocation,
  GraphNetwork,
  Pool,
  SubgraphDeployment,
  GraphAccount,
  Delegator,
  DelegatedStake,
} from '../types/schema'

import {
  createOrLoadSubgraphDeployment,
  createOrLoadIndexer,
  createOrLoadPool,
  createOrLoadEpoch,
  joinID,
  createOrLoadDelegator,
  createOrLoadDelegatedStake,
  addQm,
  createOrLoadGraphAccount,
} from './helpers'

export function handleDelegationParametersUpdated(event: DelegationParametersUpdated): void {
  let id = event.params.indexer.toHexString()
  let indexer = createOrLoadIndexer(id, event.block.timestamp)
  indexer.indexingRewardCut = event.params.indexingRewardCut.toI32()
  indexer.queryFeeCut = event.params.queryFeeCut.toI32()
  indexer.delegatorParameterCooldown = event.params.cooldownBlocks.toI32()
  indexer.lastDelegationParameterUpdate = event.block.timestamp.toI32()
  indexer.save()
}

/**
 * @dev handleStakeDeposited
 * - creates an Indexer if it is the first time they have staked
 * - updated the Indexers stake
 * - updates the GraphNetwork total stake
 */
export function handleStakeDeposited(event: StakeDeposited): void {
  // update indexer
  let id = event.params.indexer.toHexString()
  let indexer = createOrLoadIndexer(id, event.block.timestamp)
  indexer.stakedTokens = indexer.stakedTokens.plus(event.params.tokens)
  indexer.save()

  // Update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalTokensStaked = graphNetwork.totalTokensStaked.plus(event.params.tokens)
  graphNetwork.save()

  // Update epoch
  let epoch = createOrLoadEpoch(event.block.number)
  epoch.stakeDeposited = epoch.stakeDeposited.plus(event.params.tokens)
  epoch.save()
}

/**
 * @dev handleStakeLocked
 * - updated the Indexers stake
 */
export function handleStakeLocked(event: StakeLocked): void {
  // update indexer
  let id = event.params.indexer.toHexString()
  let indexer = Indexer.load(id)
  indexer.lockedTokens = event.params.tokens
  indexer.tokensLockedUntil = event.params.until.toI32()
  indexer.save()

  // update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalUnstakedTokensLocked = graphNetwork.totalUnstakedTokensLocked.plus(
    event.params.tokens,
  )
  graphNetwork.save()
}

/**
 * @dev handleStakeWithdrawn
 * - updated the Indexers stake
 * - updates the GraphNetwork total stake
 */
export function handleStakeWithdrawn(event: StakeWithdrawn): void {
  // update indexer
  let id = event.params.indexer.toHexString()
  let indexer = Indexer.load(id)
  indexer.stakedTokens = indexer.stakedTokens.minus(event.params.tokens)
  indexer.lockedTokens = indexer.lockedTokens.minus(event.params.tokens)
  indexer.tokensLockedUntil = 0 // always set to 0 when withdrawn
  indexer.save()

  // Update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalTokensStaked = graphNetwork.totalTokensStaked.minus(event.params.tokens)
  graphNetwork.totalUnstakedTokensLocked = graphNetwork.totalUnstakedTokensLocked.minus(
    event.params.tokens,
  )
  graphNetwork.save()
}

/**
 * @dev handleStakeSlashed
 * - update the Indexers stake
 */
export function handleStakeSlashed(event: StakeSlashed): void {
  let id = event.params.indexer.toHexString()
  let indexer = Indexer.load(id)

  indexer.stakedTokens = indexer.stakedTokens.minus(event.params.tokens)

  // We need to call into stakes mapping, because locked tokens might have been
  // decremented, and this is not released in the event
  // To fix this we would need to indicate in the event how many locked tokens were released
  let graphNetwork = GraphNetwork.load('1')
  let staking = Staking.bind(graphNetwork.staking as Address)
  let indexerStored = staking.stakes(event.params.indexer)
  indexer.lockedTokens = indexerStored.value2
  indexer.save()

  // Update graph network
  graphNetwork.totalTokensStaked = graphNetwork.totalTokensStaked.minus(event.params.tokens)
  graphNetwork.save()
}

export function handleStakeDelegated(event: StakeDelegated): void {
  // update indexer
  let indexerID = event.params.indexer.toHexString()
  let indexer = createOrLoadIndexer(indexerID, event.block.timestamp)
  indexer.delegatedTokens = indexer.delegatedTokens.plus(event.params.tokens)
  indexer.delegatorShares = indexer.delegatorShares.plus(event.params.shares)
  // TODO - call getIndexerCapacity to calculate it in subgraph . will need to do so on staking too.
  indexer.save()

  // update delegator
  let delegatorID = event.params.delegator.toHexString()
  let delegator = createOrLoadDelegator(delegatorID, event.block.timestamp)
  delegator.totalStakedTokens = delegator.totalStakedTokens.plus(event.params.tokens)
  delegator.save()

  // update delegated stake
  let delegatedStake = createOrLoadDelegatedStake(delegatorID, indexerID)
  delegatedStake.stakedTokens = delegatedStake.stakedTokens.plus(event.params.tokens)
  delegatedStake.shareAmount = delegatedStake.shareAmount.plus(event.params.shares)
  delegatedStake.save()

  // upgrade graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalDelegatedTokens = graphNetwork.totalDelegatedTokens.plus(event.params.tokens)
  graphNetwork.save()
}
export function handleStakeDelegatedLocked(event: StakeDelegatedLocked): void {
  // update indexer
  let indexerID = event.params.indexer.toHexString()
  let indexer = Indexer.load(indexerID)
  indexer.delegatedTokens = indexer.delegatedTokens.minus(event.params.tokens)
  indexer.delegatorShares = indexer.delegatorShares.minus(event.params.shares)
  // TODO - call getIndexerCapacity to calculate it in subgraph . will need to do so on staking too.
  indexer.save()

  // update delegator
  let delegatorID = event.params.delegator.toHexString()
  let delegator = Delegator.load(delegatorID)
  delegator.totalUnstakedTokens = delegator.totalUnstakedTokens.plus(event.params.tokens)
  delegator.save()

  // update delegated stake
  let id = joinID([delegatorID, indexerID])
  let delegatedStake = DelegatedStake.load(id)
  delegatedStake.unstakedTokens = delegatedStake.unstakedTokens.plus(event.params.tokens)
  delegatedStake.shareAmount = delegatedStake.shareAmount.minus(event.params.shares)
  delegatedStake.lockedTokens = delegatedStake.lockedTokens.plus(event.params.tokens)
  delegatedStake.lockedUntil = event.params.until.toI32() // until always updates and overwrites the past lockedUntil time
  delegatedStake.save()

  // upgrade graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalDelegatedTokens = graphNetwork.totalDelegatedTokens.minus(event.params.tokens)
  graphNetwork.save()
}
export function handleStakeDelegatedWithdrawn(event: StakeDelegatedWithdrawn): void {
  let indexerID = event.params.indexer.toHexString()
  let delegatorID = event.params.delegator.toHexString()
  let id = joinID([delegatorID, indexerID])
  let delegatedStake = DelegatedStake.load(id)
  delegatedStake.lockedTokens = BigInt.fromI32(0)
  delegatedStake.lockedUntil = 0
  delegatedStake.save()
}

/**
 * @dev handleAllocationUpdated
 * - update the indexers stake
 * - update the subgraph total stake
 * - update the named subgraph aggregate stake
 * - update the specific allocation
 * - create a new channel
 */
export function handleAllocationCreated(event: AllocationCreated): void {
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  let indexerID = event.params.indexer.toHexString()
  let channelID = event.params.allocationID.toHexString()
  let allocationID = channelID

  // update indexer
  let indexer = Indexer.load(indexerID)
  indexer.allocatedTokens = indexer.allocatedTokens.plus(event.params.tokens)
  indexer.save()

  // update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalTokensAllocated = graphNetwork.totalTokensAllocated.plus(event.params.tokens)
  graphNetwork.save()

  // update subgraph deployment
  let deployment = createOrLoadSubgraphDeployment(subgraphDeploymentID, event.block.timestamp)
  deployment.stakedTokens = deployment.stakedTokens.plus(event.params.tokens)
  deployment.save()

  // TODO - we haven't really spec'd out what we want to do with metadata
  // ideas are gasPrice, bytesPrice, and geoHash
  // we will implement in the subgraph when we actually decide on it
  // for now, price is always 0, and the others aren't implemented.

  // create allocation
  let allocation = new Allocation(allocationID)
  allocation.price = BigInt.fromI32(0) // TODO - fix, this doesnt exist anymore
  allocation.indexer = indexerID
  allocation.subgraphDeployment = subgraphDeploymentID
  allocation.allocatedTokens = event.params.tokens
  allocation.effectiveAllocation = BigInt.fromI32(0)
  allocation.createdAtEpoch = event.params.epoch.toI32()
  allocation.createdAtBlockHash = event.block.hash
  allocation.queryFeesCollected = BigInt.fromI32(0)
  allocation.queryFeeRebates = BigInt.fromI32(0)
  allocation.curatorRewards = BigInt.fromI32(0)
  allocation.indexingRewards = BigInt.fromI32(0)
  allocation.delegationFees = BigInt.fromI32(0)
  allocation.status = 'Active'
  allocation.totalReturn = BigDecimal.fromString('0')
  allocation.annualizedReturn = BigDecimal.fromString('0')
  allocation.createdAt = event.block.timestamp.toI32()
  allocation.save()
}

// Transfers tokens from a state channel to the staking contract
// Burns fees if protocolPercentage > 0
// Collects curationFees to go to curator rewards
// calls collect() on curation, which is handled in curation.ts
// adds to the allocations collected fees
// if settled, it will add fees to the rebate pool
// Note - the name event.param.rebateFees is confusing. Rebate fees are better described
// as query Fees. rebate is from cobbs douglas, which we get from claim()
export function handleAllocationCollected(event: AllocationCollected): void {
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  let indexerID = event.params.indexer.toHexString()
  let allocationID = event.params.allocationID.toHexString()

  // update indexer
  let indexer = Indexer.load(indexerID)
  indexer.queryFeesCollected = indexer.queryFeesCollected.plus(event.params.rebateFees)
  indexer.save()

  // update allocation
  // rebateFees is the total token value minus the curation and protocol fees, as can be seen in the contracts
  // note that event.params.tokens appears to not be needed anywhere. might need to think
  // about this one more - TODO
  let allocation = Allocation.load(allocationID)
  allocation.queryFeesCollected = allocation.queryFeesCollected.plus(event.params.rebateFees)
  allocation.curatorRewards = allocation.curatorRewards.plus(event.params.curationFees)
  allocation.save()

  // Update epoch - none

  // update pool
  let pool = createOrLoadPool(event.params.epoch)
  pool.totalQueryFees = pool.totalQueryFees.plus(event.params.rebateFees)
  pool.curatorRewards = pool.curatorRewards.plus(event.params.curationFees)
  pool.save()

  // update subgraph deployment
  let deployment = SubgraphDeployment.load(subgraphDeploymentID)
  deployment.queryFeesAmount = deployment.queryFeesAmount.plus(event.params.rebateFees)
  deployment.curatorFeeRewards = deployment.curatorFeeRewards.plus(event.params.curationFees)
  deployment.save()

  // update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalQueryFees = graphNetwork.totalQueryFees.plus(event.params.rebateFees)
  graphNetwork.save()
}

/**
 * @dev handleAllocationSettled
 * - update the indexers stake
 * - update the subgraph total stake
 * - update the named subgraph aggregate stake
 * - update the specific allocation
 * - update and close the channel
 */
export function handleAllocationClosed(event: AllocationClosed): void {
  let indexerID = event.params.indexer.toHexString()
  let allocationID = event.params.allocationID.toHexString()

  // update indexer
  let indexer = Indexer.load(indexerID)
  if (event.params.sender != event.params.indexer) {
    indexer.forcedSettlements = indexer.forcedSettlements + 1
  }
  indexer.allocatedTokens = indexer.allocatedTokens.minus(event.params.tokens)
  indexer.save()

  // update allocation
  let allocation = Allocation.load(allocationID)
  allocation.poolSettledIn = event.params.epoch.toString()
  allocation.effectiveAllocation = event.params.effectiveAllocation
  allocation.status = 'Settled'
  allocation.poi = event.params.poi
  allocation.save()

  // update epoch - We do it here to have more epochs created, instead of seeing none created
  // Likely this problem would go away with a live network with long epochs
  // But we keep it here anyway. We might think of adding data in the future, like epoch.tokensClosed
  let epoch = createOrLoadEpoch(event.block.number)
  epoch.save()
  // update pool
  let pool = createOrLoadPool(event.params.epoch)
  // effective allocation is the value stored in contracts, so we use it here
  pool.allocation = pool.allocation.plus(event.params.effectiveAllocation)
  pool.save()

  // update subgraph deployment. Pretty sure this should be done here, if not
  // it would be done in handleRebateClaimed
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  let deployment = createOrLoadSubgraphDeployment(subgraphDeploymentID, event.block.timestamp)
  deployment.stakedTokens = deployment.stakedTokens.plus(event.params.tokens)
  deployment.save()

  // update graph network - none
  // Note - you only minus graphNetwork.totalTokensAllocated  upon handleRebateClaimed
}

/**
 * @dev handleRebateClaimed
 * - update pool
 * - update settlement of channel in pool
 * - update pool
 * - note - if rebate is transferred to indexer, that will be handled in graphToken.ts, and in
 *          the other case, if it is restaked, it will be handled by handleStakeDeposited
 */
export function handleRebateClaimed(event: RebateClaimed): void {
  let indexerID = event.params.indexer.toHexString()
  let allocationID = event.params.allocationID.toHexString()
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()

  // update indexer
  let indexer = Indexer.load(indexerID)
  indexer.queryFeeRebates = indexer.queryFeeRebates.plus(event.params.tokens)
  indexer.save()
  // update allocation
  let allocation = Allocation.load(allocationID)
  allocation.queryFeeRebates = event.params.tokens
  allocation.delegationFees = event.params.delegationFees
  allocation.status = 'Claimed'
  allocation.save()
  // Update epoch
  let epoch = createOrLoadEpoch(event.block.number)
  epoch.queryFeeRebates = epoch.queryFeeRebates.plus(event.params.tokens)
  epoch.save()
  // update pool
  let pool = Pool.load(event.params.forEpoch.toString())
  pool.claimedFees = pool.claimedFees.plus(event.params.tokens)
  pool.save()

  // update subgraph deployment
  let subgraphDeployment = SubgraphDeployment.load(subgraphDeploymentID)
  subgraphDeployment.queryFeeRebates = subgraphDeployment.queryFeeRebates.plus(event.params.tokens)
  subgraphDeployment.save()

  // update graph network
  let graphNetwork = GraphNetwork.load('1')
  graphNetwork.totalTokensAllocated = graphNetwork.totalTokensAllocated.minus(event.params.tokens)
  graphNetwork.save()
}

/**
 * @dev handleParameterUpdated
 * - updates all parameters of staking, depending on string passed. We then can
 *   call the contract directly to get the updated value
 */
export function handleParameterUpdated(event: ParameterUpdated): void {
  let parameter = event.params.param
  let graphNetwork = GraphNetwork.load('1')
  let staking = Staking.bind(graphNetwork.staking as Address)

  if (parameter == 'curation') {
    // Not in use now, we are waiting till we have a controller contract that
    // houses all the addresses of all contracts. So that there aren't a bunch
    // of different instances of the contract addresses across all contracts
    // graphNetwork.curation = staking.curation()
  } else if (parameter == 'thawingPeriod') {
    graphNetwork.thawingPeriod = staking.thawingPeriod().toI32()
  } else if (parameter == 'curationPercentage') {
    graphNetwork.curationPercentage = staking.curationPercentage().toI32()
  } else if (parameter == 'protocolPercentage') {
    graphNetwork.protocolFeePercentage = staking.protocolPercentage().toI32()
  } else if (parameter == 'channelDisputeEpochs') {
    graphNetwork.channelDisputeEpochs = staking.channelDisputeEpochs().toI32()
  } else if (parameter == 'maxAllocationEpochs') {
    graphNetwork.maxAllocationEpochs = staking.maxAllocationEpochs().toI32()
  } else if (parameter == 'delegationCapacity') {
    graphNetwork.delegationCapacity = staking.delegationRatio().toI32()
  } else if (parameter == 'delegationParametersCooldown') {
    graphNetwork.delegationParametersCooldown = staking.delegationParametersCooldown().toI32()
  } else if (parameter == 'delegationUnbondingPeriod') {
    graphNetwork.delegationParametersCooldown = staking.delegationUnbondingPeriod().toI32()
  }
  graphNetwork.save()
}

export function handleSetOperator(event: SetOperator): void {
  let graphAccount = GraphAccount.load(event.params.indexer.toHexString())
  let operators = graphAccount.operators
  let index = operators.indexOf(event.params.operator.toHexString())
  if (index != -1) {
    // false - it existed, and we set it to false, so remove from operators
    if (!event.params.allowed) {
      operators.splice(index, 1)
    }
  } else {
    // true - it did not exist before, and we say add, so add
    if (event.params.allowed) {
      operators.push(event.params.operator.toHexString())
      // Create the operator as a graph account
      createOrLoadGraphAccount(
        event.params.operator.toHexString(),
        event.params.operator,
        event.block.timestamp,
      )
    }
  }
  graphAccount.operators = operators
  graphAccount.save()
}

// export function handleImplementationUpdated(event: ImplementationUpdated): void {
//   let graphNetwork = GraphNetwork.load('1')
//   let implementations = graphNetwork.stakingImplementations
//   implementations.push(event.params.newImplementation)
//   graphNetwork.stakingImplementations = implementations
//   graphNetwork.save()
// }
