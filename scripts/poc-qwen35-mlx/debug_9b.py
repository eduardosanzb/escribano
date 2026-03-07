#!/usr/bin/env python3
"""
Debug script for Qwen3.5-9B model.

Tests Prompt A with both raw and chat-template formats to understand
why the model fails validation after adding chat templates.
"""

import sys
import re
from mlx_lm import load, generate
from prompts import (
    fetch_sample_topic_blocks,
    build_subject_grouping_prompt,
)

def validate_and_analyze(output: str, block_ids: list, label: str):
    """Analyze output and show exactly what's happening."""
    print(f"\n{'='*80}")
    print(f"{label}")
    print(f"{'='*80}")
    
    # Show full output
    print(f"\n[Full Output ({len(output)} chars)]:")
    print(output)
    print(f"\n{'-'*80}")
    
    # Check for group pattern
    pattern = r"Group \d+: label: .+ \| blockIds: \[.+\]"
    matches = re.findall(pattern, output)
    print(f"\n[Pattern Matching]:")
    print(f"  Found {len(matches)} group lines matching pattern")
    if matches:
        for i, match in enumerate(matches[:3], 1):
            print(f"  {i}. {match[:100]}...")
    
    # Check UUID presence
    print(f"\n[UUID Analysis]:")
    print(f"  Expected {len(block_ids)} block IDs")
    present = []
    missing = []
    for bid in block_ids:
        if bid in output:
            present.append(bid)
        else:
            missing.append(bid)
    
    print(f"  Present: {len(present)}/{len(block_ids)}")
    if present:
        print(f"    ✅ {present[:2]}...")
    if missing:
        print(f"  Missing: {len(missing)}/{len(block_ids)}")
        print(f"    ❌ {missing[:2]}...")
    
    # Check for alternative formats
    print(f"\n[Alternative Formats]:")
    if "blockIds:" in output.lower():
        print("  ✓ Contains 'blockIds:'")
    else:
        print("  ✗ No 'blockIds:' found")
    
    if "Group" in output:
        print("  ✓ Contains 'Group'")
    else:
        print("  ✗ No 'Group' found")
    
    # Overall validation
    passed = len(matches) >= 1 and len(missing) == 0
    print(f"\n[Validation]: {'✅ PASS' if passed else '❌ FAIL'}")
    
    return passed


def main():
    print("="*80)
    print("Qwen3.5-9B Debug Script")
    print("="*80)
    
    # Load model
    print("\n[1/4] Loading Qwen3.5-9B-OptiQ-4bit...")
    model_obj, tokenizer = load("mlx-community/Qwen3.5-9B-OptiQ-4bit")
    print("✓ Loaded")
    
    # Fetch real data
    print("\n[2/4] Fetching TopicBlocks from database...")
    blocks = fetch_sample_topic_blocks(limit=5)
    if not blocks:
        print("❌ No blocks found in database!")
        sys.exit(1)
    
    block_ids = [b['id'] for b in blocks]
    print(f"✓ Found {len(blocks)} blocks")
    print(f"  Block IDs: {block_ids[:2]}...")
    
    # Build prompt
    prompt_raw = build_subject_grouping_prompt(blocks)
    print(f"\n[3/4] Prompt built ({len(prompt_raw)} chars)")
    
    # Test 1: Raw prompt (old way)
    print("\n[4/4] Testing Prompt A...")
    print("\n" + "="*80)
    print("TEST 1: Raw Prompt (NO chat template)")
    print("="*80)
    
    output_raw = generate(
        model_obj,
        tokenizer,
        prompt=prompt_raw,
        max_tokens=2000,
        verbose=False,
    )
    
    passed_raw = validate_and_analyze(output_raw, block_ids, "Raw Prompt Output")
    
    # Test 2: Chat template (new way)
    print("\n" + "="*80)
    print("TEST 2: Chat Template (enable_thinking=False)")
    print("="*80)
    
    messages = [{"role": "user", "content": prompt_raw}]
    prompt_formatted = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        chat_template_kwargs={"enable_thinking": False}
    )
    
    print(f"\n[Formatted Prompt ({len(prompt_formatted)} chars)]:")
    print(prompt_formatted[:500] + "..." if len(prompt_formatted) > 500 else prompt_formatted)
    
    output_formatted = generate(
        model_obj,
        tokenizer,
        prompt=prompt_formatted,
        max_tokens=2000,
        verbose=False,
    )
    
    passed_formatted = validate_and_analyze(output_formatted, block_ids, "Chat Template Output")
    
    # Summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    print(f"Raw prompt:       {'✅ PASS' if passed_raw else '❌ FAIL'}")
    print(f"Chat template:    {'✅ PASS' if passed_formatted else '❌ FAIL'}")
    
    if passed_raw and not passed_formatted:
        print("\n⚠️  Chat template breaks validation!")
        print("   The formatted prompt changes the model's output format.")
    elif not passed_raw and not passed_formatted:
        print("\n⚠️  Both formats fail!")
        print("   The prompt or validation logic needs adjustment.")
    else:
        print("\n✅ Both formats work!")


if __name__ == "__main__":
    main()
