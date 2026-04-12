"""
Setup script for Lore Hermes Plugin
"""

from setuptools import setup, find_packages

with open("SKILL.md", "r", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="lore-hermes",
    version="1.0.0",
    author="Hermes",
    description="Long-term memory integration for Hermes Agent using Lore",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/FFatTiger/lore",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.8",
    install_requires=[],
    extras_require={
        "dev": ["pytest", "pytest-asyncio", "black", "mypy"],
    },
)
