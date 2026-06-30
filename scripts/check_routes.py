"""Quick test script for webapp route validation."""
from webapp.main import app

print("=== All Registered Routes ===")
for route in app.routes:
    path = getattr(route, "path", str(route))
    methods = getattr(route, "methods", set())
    name = getattr(route, "name", "")
    print(f"  {','.join(sorted(methods)) if methods else '--':8s} {path}  ({name})")
