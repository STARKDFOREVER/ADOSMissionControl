//! The step graph — the core ordering engine the whole crate exists to
//! guarantee.
//!
//! Steps declare their dependencies (`requires`) by id. The graph topologically
//! orders them (stable, deterministic) and runs each only when *all* of its
//! dependencies have succeeded. The load-bearing invariant: when a **Required**
//! step fails, no later step runs — the install aborts cleanly and writes a
//! result naming the failure, rather than charging ahead into a half-installed
//! state. Optional failures are recorded (the install degrades) but do not
//! abort the run.

use std::collections::{BTreeMap, BTreeSet};

use crate::ctx::Ctx;

/// Whether a step's failure is fatal to the install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    /// Failure aborts the install (status → `failed`); later steps do not run.
    Required,
    /// Failure degrades the install (status → `degraded`); the run continues.
    Optional,
}

pub use ados_term::StepOutcome;

/// A single install step. Implementors are unit structs (no per-step state);
/// all mutable state lives in [`Ctx`].
pub trait Step {
    /// Stable, unique step id (also the failure-report key).
    fn id(&self) -> &str;
    /// Ids of the steps that must succeed before this one runs.
    fn requires(&self) -> &[&str];
    /// Whether a failure is Required (fatal) or Optional (degrading).
    fn kind(&self) -> StepKind;
    /// Do the step's work, returning [`StepOutcome::Ok`] on success,
    /// [`StepOutcome::Skipped`] when there is nothing to do (not applicable to
    /// this profile), or [`StepOutcome::Failed`] with a reason.
    fn run(&self, ctx: &mut Ctx) -> StepOutcome;
}

/// Why a graph could not be ordered (a programming error in the step set, not
/// a runtime install failure).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GraphError {
    /// A step's `requires` names an id no step in the set provides.
    #[error("step {step:?} requires unknown step {missing:?}")]
    UnknownRequire { step: String, missing: String },
    /// The dependency edges form a cycle.
    #[error("dependency cycle detected among steps: {0:?}")]
    Cycle(Vec<String>),
    /// Two steps share an id.
    #[error("duplicate step id {0:?}")]
    DuplicateId(String),
}

/// The per-step result of a graph run, for inspection (tests + the final
/// result write). Order matches execution order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepReport {
    /// The step id.
    pub id: String,
    /// What happened to the step.
    pub outcome: StepOutcome,
}

/// Topologically order the step ids by their `requires` edges. Stable: among
/// steps with no ordering constraint, the original insertion order is
/// preserved (a deterministic Kahn's algorithm over a sorted-but-insertion-keyed
/// ready set). Returns the ordered ids, or a [`GraphError`] for an unknown
/// require / cycle / duplicate id.
pub fn topo_order(steps: &[Box<dyn Step>]) -> Result<Vec<String>, GraphError> {
    // Insertion index per id (defines the stable tiebreak).
    let mut index: BTreeMap<String, usize> = BTreeMap::new();
    for (i, s) in steps.iter().enumerate() {
        if index.insert(s.id().to_string(), i).is_some() {
            return Err(GraphError::DuplicateId(s.id().to_string()));
        }
    }

    // Validate requires + build the indegree + adjacency.
    let mut indegree: BTreeMap<String, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for s in steps {
        indegree.entry(s.id().to_string()).or_insert(0);
        for req in s.requires() {
            if !index.contains_key(*req) {
                return Err(GraphError::UnknownRequire {
                    step: s.id().to_string(),
                    missing: req.to_string(),
                });
            }
            *indegree.entry(s.id().to_string()).or_insert(0) += 1;
            dependents
                .entry(req.to_string())
                .or_default()
                .push(s.id().to_string());
        }
    }

    // Kahn's algorithm. The ready set drains in insertion order so the result
    // is stable across runs.
    let mut ready: Vec<String> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| id.clone())
        .collect();
    ready.sort_by_key(|id| index[id]);

    let mut ordered: Vec<String> = Vec::with_capacity(steps.len());
    while let Some(id) = pop_lowest_index(&mut ready, &index) {
        ordered.push(id.clone());
        if let Some(deps) = dependents.get(&id) {
            for dep in deps {
                let d = indegree.get_mut(dep).expect("dependent has an indegree");
                *d -= 1;
                if *d == 0 {
                    ready.push(dep.clone());
                }
            }
        }
    }

    if ordered.len() != steps.len() {
        // The unscheduled remainder is the cycle membership.
        let scheduled: BTreeSet<&String> = ordered.iter().collect();
        let cycle: Vec<String> = steps
            .iter()
            .map(|s| s.id().to_string())
            .filter(|id| !scheduled.contains(id))
            .collect();
        return Err(GraphError::Cycle(cycle));
    }

    Ok(ordered)
}

/// Remove and return the ready id with the lowest insertion index (the stable
/// tiebreak).
fn pop_lowest_index(ready: &mut Vec<String>, index: &BTreeMap<String, usize>) -> Option<String> {
    let pos = ready
        .iter()
        .enumerate()
        .min_by_key(|(_, id)| index[*id])
        .map(|(pos, _)| pos)?;
    Some(ready.remove(pos))
}

/// Run the step graph against the context, recording failures into
/// `ctx.failures`. Returns the per-step report in execution order.
///
/// Rules, in order, per step (in topological order):
/// 1. If any of the step's `requires` did not SUCCEED → the step is blocked:
///    [`StepOutcome::Skipped`], not run.
/// 2. If the graph is ABORTING (a Required step failed earlier) → blocked:
///    [`StepOutcome::Skipped`], not run.
/// 3. Otherwise run it. On [`StepOutcome::Failed`] record into `ctx.failures`
///    (required iff `kind() == Required`); a Required failure flips the graph
///    to ABORTING.
///
/// A malformed graph (cycle / unknown require) is itself a hard error and is
/// surfaced as a synthetic Required failure of a `graph` pseudo-step so the
/// install fails loudly rather than silently doing nothing.
pub fn run_graph(steps: Vec<Box<dyn Step>>, ctx: &mut Ctx) -> Vec<StepReport> {
    let order = match topo_order(&steps) {
        Ok(o) => o,
        Err(e) => {
            tracing::error!(error = %e, "install step graph is malformed");
            ctx.failures.record("graph", true);
            return vec![StepReport {
                id: "graph".to_string(),
                outcome: StepOutcome::Failed(e.to_string()),
            }];
        }
    };

    // Lookup by id into the boxed steps.
    let by_id: BTreeMap<&str, &Box<dyn Step>> = steps.iter().map(|s| (s.id(), s)).collect();

    let mut succeeded: BTreeSet<String> = BTreeSet::new();
    let mut aborting = false;
    let mut reports: Vec<StepReport> = Vec::with_capacity(order.len());

    for id in &order {
        let step = by_id[id.as_str()];

        // (1) Blocked by an unsuccessful dependency.
        let deps_ok = step.requires().iter().all(|r| succeeded.contains(*r));
        if !deps_ok {
            tracing::warn!(step = %id, "skipped: a required dependency did not succeed");
            ctx.progress.step_result(id, &StepOutcome::Skipped);
            reports.push(StepReport {
                id: id.clone(),
                outcome: StepOutcome::Skipped,
            });
            continue;
        }

        // (2) Blocked because a Required step already failed.
        if aborting {
            tracing::warn!(step = %id, "skipped: install aborting after a required failure");
            ctx.progress.step_result(id, &StepOutcome::Skipped);
            reports.push(StepReport {
                id: id.clone(),
                outcome: StepOutcome::Skipped,
            });
            continue;
        }

        // (3) Run.
        ctx.progress.step_started(id);
        let outcome = step.run(ctx);
        match &outcome {
            StepOutcome::Ok | StepOutcome::Skipped => {
                succeeded.insert(id.clone());
            }
            StepOutcome::Failed(msg) => {
                let required = step.kind() == StepKind::Required;
                tracing::error!(step = %id, required, reason = %msg, "step failed");
                ctx.failures.record(id, required);
                if required {
                    aborting = true;
                }
            }
        }
        ctx.progress.step_result(id, &outcome);
        reports.push(StepReport {
            id: id.clone(),
            outcome,
        });
    }

    reports
}

#[cfg(test)]
mod tests;
