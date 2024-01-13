#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
	template <typename T>
	class ArrayBuffer {
		public:
			ArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags bufferUsage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, uint32_t totalSize = 1000000u);
			~ArrayBuffer();

			VkDescriptorBufferInfo getInfo() const { return this->buffer->descriptorInfo(); }
			NugieVulkan::Buffer* getBuffer() const { return this->buffer; }
			uint32_t size() const { return this->count; }

			void replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects);
			
		private:
			NugieVulkan::Device* device;
			uint32_t count;

			NugieVulkan::Buffer* stagingBuffer;
			NugieVulkan::Buffer* buffer;

			void createBuffers(VkBufferUsageFlags bufferUsage, uint32_t totalSize);
	};

	template <typename T>
	ArrayBuffer<T>::ArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags bufferUsage, uint32_t totalSize) : device{device} {
		this->createBuffers(bufferUsage, totalSize);
	}

	template <typename T>
	ArrayBuffer<T>::~ArrayBuffer() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	template <typename T>
	void ArrayBuffer<T>::createBuffers(VkBufferUsageFlags bufferUsage, uint32_t totalSize) {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(T));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
		);

		if (!(bufferUsage & (1 << VK_BUFFER_USAGE_TRANSFER_DST_BIT))) {
			bufferUsage |= VK_BUFFER_USAGE_TRANSFER_DST_BIT;
		}

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			bufferUsage,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
		);

		this->stagingBuffer->map();
	}

	template <typename T>
	void ArrayBuffer<T>::replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects) {
		this->count = static_cast<uint32_t>(objects.size());
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(T)) * static_cast<VkDeviceSize>(this->count);
		
		this->stagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp
