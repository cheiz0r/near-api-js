use std::sync::Arc;
use std::time::Duration;

use futures::sync::mpsc::{Receiver, Sender};
use futures::{future, Future, Sink, Stream};
use tokio::{self, timer::Interval};

use client::Client;
use mempool::pool_task::MemPoolControl;
use nightshade::nightshade::{BlockProposal, ConsensusBlockProposal};
use primitives::hash::CryptoHash;
use primitives::block_traits::SignedBlock;

pub fn spawn_consensus(
    client: Arc<Client>,
    consensus_tx: Sender<ConsensusBlockProposal>,
    mempool_control_rx: Receiver<MemPoolControl>,
    block_period: Duration,
) {
    let initial_beacon_block_index = client.beacon_chain.chain.best_index();
    let task = Interval::new_interval(block_period)
        .fold(
            (mempool_control_rx, initial_beacon_block_index),
            move |(mempool_control_rx, mut beacon_block_index), _| {
                let hash = client.shard_client.pool.snapshot_payload();
                let last_shard_block = client.shard_client.chain.best_block();
                let receipt_block = client.shard_client.get_receipt_block(last_shard_block.index(), last_shard_block.shard_id());
                if hash != CryptoHash::default() || receipt_block.is_some() {
                    beacon_block_index += 1;
                    let c = ConsensusBlockProposal {
                        proposal: BlockProposal { author: 0, hash },
                        index: beacon_block_index,
                    };
                    tokio::spawn(consensus_tx.clone().send(c).map(|_| ()).map_err(|e| {
                        error!("Failure sending pass-through consensus {}", e);
                    }));
                    future::ok((mempool_control_rx, beacon_block_index))
                } else {
                    future::ok((mempool_control_rx, beacon_block_index))
                }
            },
        )
        .map(|_| ())
        .map_err(|e| error!("timer error: {}", e));

    tokio::spawn(task);
}