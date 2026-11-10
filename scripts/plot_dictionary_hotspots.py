"""Plot recorded renderer toplevel intervals, including microtask checkpoints."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

root = Path("docs/performance")
actions = ["open-cold", "scroll", "preview", "input-warm", "open-warm"]
for device in ["mobile", "desktop"]:
    data = json.loads((root / f"text-hotspots-{device}.json").read_text())
    fig, axes = plt.subplots(5, 2, figsize=(14, 14), constrained_layout=True)
    for column, host in enumerate(["web", "native"]):
        for row, action in enumerate(actions):
            ax = axes[row, column]
            records = {item["phase"]: item for item in data if item["host"] == host and item["action"] == action}
            for phase, y, color in [("before", 1, "#c45745"), ("after", 0, "#287f79")]:
                record = records[phase]
                spans = [(task["startMs"], task["durationMs"]) for task in record["longTasks"]]
                ax.broken_barh(spans, (y - 0.28, 0.56), facecolors=color)
                ax.text(1, y, f" max {record['longestTaskMs']:.0f} ms", transform=ax.get_yaxis_transform(), va="center", fontsize=9)
            ax.set_title(f"{host} / {action}", loc="left", fontsize=11)
            ax.set_yticks([0, 1], ["after", "before"])
            ax.set_ylim(-0.6, 1.6)
            ax.set_xlim(0, max(item["elapsedMs"] for item in records.values()) * 1.01)
            ax.set_xlabel("Milliseconds since action start")
            ax.grid(axis="x", alpha=0.2)
            ax.spines[["top", "right"]].set_visible(False)
    fig.suptitle(f"Long main-thread intervals (>=50 ms) / {device}" + (" / CPU 4x, touch emulation" if device == "mobile" else " / CPU 1x"), fontsize=15)
    fig.legend(handles=[Patch(color="#c45745", label="beta.6"), Patch(color="#287f79", label="beta.7 candidate")], loc="outside lower center", ncol=2)
    fig.savefig(root / f"text-hotspots-waterfall-{device}.svg")
    fig.savefig(root / f"text-hotspots-waterfall-{device}.png", dpi=130)
    plt.close(fig)
