#include "index_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	IndexModel::IndexModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	IndexModel::~IndexModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void IndexModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(uint32_t));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_INDEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void IndexModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<uint32_t> indices) {
		this->indexCount = static_cast<uint32_t>(indices.size());
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(uint32_t)) * static_cast<VkDeviceSize>(this->indexCount);

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) indices.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp

