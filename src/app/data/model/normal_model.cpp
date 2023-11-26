#include "normal_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	NormalModel::NormalModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	NormalModel::~NormalModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void NormalModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(Normal));

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
			VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void NormalModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Normal> normals) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Normal)) * static_cast<VkDeviceSize>(normals.size());

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) normals.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp

