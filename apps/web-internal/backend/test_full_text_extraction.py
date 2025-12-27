import fitz

pdf_path = "uploads/projects/43cbc372-5161-44fb-ba48-8973c30d1d09/Chick-fil-A Love Field FSU 03904 -CPS/03904 Constr Set Archs/03904 Constr Set Archs/A000 Egress Plan.pdf"

doc = fitz.open(pdf_path)
page = doc[0]

print(f"Page rotation: {page.rotation}")
print(f"Page rect: {page.rect}")

text_dict = page.get_text("dict")  # No clip

blocks = text_dict.get("blocks", [])
print(f"Total blocks: {len(blocks)}")

span_count = 0
for block in blocks:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            span_count += 1
            if span_count <= 20:
                print(f"Span {span_count}: '{span['text']}' bbox={span['bbox']}")

print(f"Total spans: {span_count}")

# Search for target text
for block in blocks:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            if "CROSS SLOPES" in span["text"]:
                print(f"\nFound target text: '{span['text']}'")
                print(f"Full bbox: {span['bbox']}")

