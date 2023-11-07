#include "position_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	PositionModel::PositionModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	PositionModel::~PositionModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void PositionModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(glm::vec4));

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
			VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void PositionModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<glm::vec4> positions) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(glm::vec4)) * static_cast<VkDeviceSize>(positions.size());

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) positions.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp

