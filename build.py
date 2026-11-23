"""Build the double-clickable Sonoravell.html from the editable source."""
from pathlib import Path
import base64
import re

root = Path(__file__).resolve().parent
source = root / "src"
html = (source / "index.html").read_text(encoding="utf-8")
icon_svg = (source / "assets" / "app-icon.svg").read_text(encoding="utf-8")
icon = base64.b64encode(icon_svg.encode("utf-8")).decode("ascii")
html = html.replace("assets/app-icon.svg", "data:image/svg+xml;base64," + icon)
css = (source / "studio.css").read_text(encoding="utf-8")
atlas = base64.b64encode((source / "assets/plug-in-atlas.webp").read_bytes()).decode("ascii")
css = css.replace("assets/plug-in-atlas.webp", "data:image/webp;base64," + atlas)
html = html.replace('<link rel="stylesheet" href="studio.css">', f"<style>\n{css}\n</style>")
html = re.sub(
    r'<script defer src="([^"]+)"></script>',
    lambda match: "<script defer>\n" + (source / match[1]).read_text(encoding="utf-8") + "\n</script>",
    html,
)
# Inline classic scripts run in sequence. Put them after the DOM they use.
scripts = re.findall(r"<script defer>.*?</script>", html, re.S)
html = re.sub(r"^[ \t]*<script defer>.*?</script>[ \t]*$", "", html, flags=re.S | re.M)
html = html.replace("</body>", "\n".join(scripts).replace("<script defer>", "<script>") + "\n</body>")
(root / "Sonoravell.html").write_bytes(html.encode("utf-8"))
