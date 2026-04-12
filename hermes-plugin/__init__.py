"""
Lore Hermes Plugin - Root entry point for Hermes native plugin system

This file is the entry point that Hermes plugin system looks for.
It delegates to the actual implementation in lore_hermes package.
"""

# Re-export the register function for Hermes plugin system
from lore_hermes import register

__all__ = ["register"]
