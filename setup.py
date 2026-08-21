from setuptools import setup, find_packages

setup(
    name="open-ucp",
    version="1.0.0",
    package_dir={"": "python"},
    packages=find_packages(where="python"),
    python_requires=">=3.10",
    install_requires=[],
    extras_require={
        "fastapi": ["fastapi>=0.100.0", "starlette>=0.27.0"],
    },
    entry_points={
        "console_scripts": [
            "open-ucp-py = open_ucp.cli:main",
        ],
    },
)
