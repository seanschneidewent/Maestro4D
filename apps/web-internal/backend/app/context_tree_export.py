import json
from app.database import SessionLocal
from app.models import PageContext, ContextPointer, DisciplineContext

db = SessionLocal()

# Get all pages with their pointers
pages = db.query(PageContext).all()
disciplines = db.query(DisciplineContext).all()

export = {
    "disciplines": [
        {
            "code": d.code,
            "name": d.name,
            "status": d.processing_status,
            "context": d.context_description,
            "key_contents": d.key_contents,
            "connections": d.connections
        }
        for d in disciplines
    ],
    "pages": [
        {
            "sheet": p.sheet_number,
            "title": p.page_title,
            "discipline": p.discipline_code,
            "status": p.processing_status,
            "context": p.context_description,
            "identifiers": p.identifiers,
            "cross_refs": p.cross_refs,
            "pointers": [
                {
                    "title": ptr.title,
                    "description": ptr.description,
                    "bounds": {
                        "x": ptr.bounds_x,
                        "y": ptr.bounds_y,
                        "w": ptr.bounds_w,
                        "h": ptr.bounds_h
                    }
                }
                for ptr in p.context_pointers
            ]
        }
        for p in pages
    ]
}

with open("context_tree_export.json", "w") as f:
    json.dump(export, f, indent=2)

print(f"Exported {len(disciplines)} disciplines, {len(pages)} pages")
db.close()