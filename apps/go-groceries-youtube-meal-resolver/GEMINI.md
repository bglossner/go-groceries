# Project Summary: Go Groceries YouTube Meal Resolver

This repository contains a Cloudflare Worker designed to act as an intermediary API for the "Go Groceries" web application. Its primary function is to process YouTube video links to extract relevant information for meal preparation.

## Core Functionality

The main API endpoint of this worker accepts a YouTube video URL as input. It then utilizes the YouTube Data API v3 to retrieve the following details:

- **Video Description:** The full description of the YouTube video.
- **Author Comments:** Any comments made by the original uploader (author) of the video.

This extracted information is intended to help the "Go Groceries" webapp automatically populate details necessary for meal planning and preparation based on YouTube content.