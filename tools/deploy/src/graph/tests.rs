use super::*;
use std::cell::RefCell;

// A test step that records into a shared run-recorder when its run() fires,
// and returns a configured outcome. The recorder lets a test assert which
// steps were actually executed (vs skipped/blocked).
struct TestStep {
    id: &'static str,
    requires: Vec<&'static str>,
    kind: StepKind,
    outcome: StepOutcome,
    ran: &'static RecordCell,
}

type RecordCell = RefCell<Vec<String>>;

impl Step for TestStep {
    fn id(&self) -> &str {
        self.id
    }
    fn requires(&self) -> &[&str] {
        &self.requires
    }
    fn kind(&self) -> StepKind {
        self.kind
    }
    fn run(&self, _ctx: &mut Ctx) -> StepOutcome {
        self.ran.borrow_mut().push(self.id.to_string());
        self.outcome.clone()
    }
}

fn ctx() -> Ctx {
    Ctx::for_test()
}

fn recorder() -> &'static RecordCell {
    Box::leak(Box::new(RefCell::new(Vec::new())))
}

#[test]
fn topo_order_respects_requires() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![
        Box::new(TestStep {
            id: "c",
            requires: vec!["b"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
        Box::new(TestStep {
            id: "b",
            requires: vec!["a"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
        Box::new(TestStep {
            id: "a",
            requires: vec![],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
    ];
    let order = topo_order(&steps).unwrap();
    // a before b before c, regardless of insertion order.
    let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
    assert!(pos("a") < pos("b"));
    assert!(pos("b") < pos("c"));
}

#[test]
fn unknown_require_is_a_graph_error() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![Box::new(TestStep {
        id: "b",
        requires: vec!["a"], // no step 'a'
        kind: StepKind::Required,
        outcome: StepOutcome::Ok,
        ran,
    })];
    let err = topo_order(&steps).unwrap_err();
    assert_eq!(
        err,
        GraphError::UnknownRequire {
            step: "b".to_string(),
            missing: "a".to_string()
        }
    );
}

#[test]
fn cycle_is_detected() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![
        Box::new(TestStep {
            id: "a",
            requires: vec!["b"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
        Box::new(TestStep {
            id: "b",
            requires: vec!["a"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
    ];
    let err = topo_order(&steps).unwrap_err();
    assert!(matches!(err, GraphError::Cycle(_)));
}

#[test]
fn required_failure_blocks_dependent_step() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![
        Box::new(TestStep {
            id: "first",
            requires: vec![],
            kind: StepKind::Required,
            outcome: StepOutcome::Failed("boom".to_string()),
            ran,
        }),
        Box::new(TestStep {
            id: "second",
            requires: vec!["first"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
    ];
    let mut c = ctx();
    let reports = run_graph(steps, &mut c);
    // first ran and failed; second was blocked (never ran).
    assert_eq!(ran.borrow().as_slice(), &["first".to_string()]);
    assert_eq!(c.failures.derive_status(), "failed");
    let second = reports.iter().find(|r| r.id == "second").unwrap();
    assert_eq!(second.outcome, StepOutcome::Skipped);
}

// THE ordering-invariant the whole crate exists to guarantee: a Required
// fetch_binaries failure must mean systemd.run is NEVER called.
#[test]
fn systemd_never_runs_when_required_fetch_binaries_fails() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![
        Box::new(TestStep {
            id: "fetch_binaries",
            requires: vec![],
            kind: StepKind::Required,
            outcome: StepOutcome::Failed("no network".to_string()),
            ran,
        }),
        Box::new(TestStep {
            id: "systemd",
            requires: vec!["fetch_binaries"],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
    ];
    let mut c = ctx();
    run_graph(steps, &mut c);
    // systemd must NOT appear in the run recorder.
    assert!(
        !ran.borrow().contains(&"systemd".to_string()),
        "systemd.run was called after fetch_binaries (Required) failed: {:?}",
        ran.borrow()
    );
    assert_eq!(ran.borrow().as_slice(), &["fetch_binaries".to_string()]);
    assert_eq!(c.failures.derive_status(), "failed");
    assert_eq!(c.failures.required, vec!["fetch_binaries".to_string()]);
}

#[test]
fn optional_failure_degrades_but_does_not_block() {
    let ran = recorder();
    let steps: Vec<Box<dyn Step>> = vec![
        Box::new(TestStep {
            id: "dkms",
            requires: vec![],
            kind: StepKind::Optional,
            outcome: StepOutcome::Failed("no compiler".to_string()),
            ran,
        }),
        Box::new(TestStep {
            id: "systemd",
            requires: vec![],
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        }),
    ];
    let mut c = ctx();
    run_graph(steps, &mut c);
    // Both ran; the optional failure degrades but did not abort systemd.
    assert!(ran.borrow().contains(&"systemd".to_string()));
    assert_eq!(c.failures.derive_status(), "degraded");
}
