# Architecture Diagram — Recreation Guide

Use this to recreate the diagram in draw.io or Excalidraw.

---

## Boxes

Draw 5 boxes:

| # | Label | Color |
|---|---|---|
| 1 | `Client` | Purple |
| 2 | `API Server` | Dark blue |
| 3 | `PostgreSQL` | Blue |
| 4 | `Redis / BullMQ` | Red |
| 5 | `Worker` | Green |

---

## Arrows

| From | To | Label |
|---|---|---|
| Client | API Server | `POST /api/tasks` |
| API Server | PostgreSQL | `store task: PENDING` |
| API Server | Redis / BullMQ | `enqueue job` |
| Redis / BullMQ | Worker | `pick up job` |
| Worker | PostgreSQL | `PROCESSING → COMPLETED / FAILED` |

---

## Layout

```
        [Client]
            |
            | POST /api/tasks
            ▼
        [API Server]
        /           \
 store PENDING    enqueue job
       ▼               ▼
 [PostgreSQL]   [Redis / BullMQ]
       ▲               |
       |         pick up job
       |               ▼
       └────────── [Worker]
        PROCESSING → COMPLETED/FAILED
```

---

## File placement

Save as `docs/architecture.png`, then add to README:

```markdown
![Architecture](./docs/architecture.png)
```
